---
layout: post
title: "28 🎯 Kafka Internals #5: KRaft - The Controller Architecture"
date: 2025-11-11
categories: ["apache-kafka", "distributed-systems", "raft"]
---

In previous posts, we explored Kafka's [broker request processing](/posts/kafka-internals-broker-request-processing), [storage layer](/posts/kafka-internals-storage-layer-and-log-segments), [replication protocol](/posts/kafka-internals-replication-protocol), and [consumer group coordination](/posts/kafka-internals-consumer-groups-coordination). 
Today, we dive into **KRaft** (Kafka Raft), the new controller architecture that eliminates Kafka's dependency on ZooKeeper.

## What is KRaft?

KRaft is Kafka's built-in consensus protocol based on the [Raft algorithm](https://raft.github.io/). 
In case of interest here is an extended version of [Raft protocol](https://raft.github.io/raft.pdf).
It replaces ZooKeeper for managing cluster metadata, providing a self-contained, simpler architecture for Kafka clusters.

## The Problem with ZooKeeper

Before KRaft, Kafka relied on ZooKeeper for:
- Controller election
- Metadata storage (brokers, topics, partitions, ISRs)
- Configuration management
- ACLs and quotas

**Challenges:**
1. **Operational Complexity**: Managing two distributed systems (Kafka + ZooKeeper)
2. **Scalability Limits**: ZooKeeper struggled with >200K partitions per cluster
3. **Slow Metadata Propagation**: Controller -> ZooKeeper -> Brokers path introduced latency
4. **Recovery Time**: Large metadata sets caused slow controller failover (minutes)
5. **Split-Brain Risk**: ZooKeeper session timeouts could cause leadership conflicts

## KRaft Benefits

There were many benefits why KRaft is the better choice than having another external distributed system for managing
elections, metadata storage, ACLs, quotas and in general configuration management. 
At first, deployment just using Kafka instead having two systems.
Moreover, KRaft improved handling more partitions (i.e., millions per cluster) when ZooKeeper struggled with ~200k per cluster. 
Controller failover took just <1 seconds instead 10-30 seconds when using ZooKeeper.
Metadata propagation in KRaft is event-driven (i.e., fast) instead polling-based (i.e., when using ZooKeeper).

## Architecture Overview

KRaft uses a **controller quorum** (typically 3 or 5 dedicated controller nodes) running the Raft consensus protocol:

```
┌─────────────────────────────────────────────────────────────┐
│                    Controller Quorum                        │
│    ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│    │ Controller 1 │  │ Controller 2 │  │ Controller 3 │     │
│    │  (LEADER)    │  │  (FOLLOWER)  │  │  (FOLLOWER)  │     │
│    └──────────────┘  └──────────────┘  └──────────────┘     │
│           │                  │                  │           │
│           └──────────────────┴──────────────────┘           │
│                      __cluster_metadata                     │
│                  (Raft replicated log)                      │
└─────────────────────────────────────────────────────────────┘
                               │
                               │ MetadataFetch (pull-based)
                               ↓
┌─────────────────────────────────────────────────────────────┐
│                     Broker Cluster                          │
│       ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐        │
│       │Broker 1│  │Broker 2│  │Broker 3│  │Broker 4│        │
│       └────────┘  └────────┘  └────────┘  └────────┘        │
│          │            │            │            │           │
│          └────────────┴────────────┴────────────┘           │
│                Local Metadata Cache                         │
└─────────────────────────────────────────────────────────────┘
```

**Key concepts:**
- **Active Controller**: The Raft leader, handles all metadata changes
- **Standby Controllers**: Raft followers, replicate metadata log, ready for failover
- **Metadata Log**: Special topic `__cluster_metadata` storing all cluster metadata
- **Single-Threaded Design**: QuorumController uses event queue, no complex locking needed

## Core Components

### 1. QuorumController

**Location**: `metadata/src/main/java/org/apache/kafka/controller/QuorumController.java`

The brain of KRaft mode, which implements the active controller logic.

From QuorumController.java:154:

```java
/**
 * QuorumController implements the main logic of the KRaft (Kafka Raft Metadata) mode controller.
 *
 * The node which is the leader of the metadata log becomes the active controller.  All
 * other nodes remain in standby mode.  Standby controllers cannot create new metadata log
 * entries.  They just replay the metadata log entries that the current active controller
 * has created.
 *
 * The QuorumController is single-threaded.  A single event handler thread performs most
 * operations.  This avoids the need for complex locking.
 *
 * The controller exposes an asynchronous, futures-based API to the world.
 */
public final class QuorumController implements Controller {
    // ...
}
```

**Key responsibilities:**
- Broker registration and heartbeats
- Topic/partition creation and deletion
- Leader election for partitions
- ISR management (via **AlterPartition** requests)
- Configuration management
- ACL and quota management

### 2. KafkaRaftClient

**Location**: `raft/src/main/java/org/apache/kafka/raft/KafkaRaftClient.java`

Implements the Raft consensus protocol.

From KafkaRaftClient.java:128:

```java
/**
 * This class implements a Kafkaesque version of the Raft protocol. Leader election
 * is more or less pure Raft, but replication is driven by replica fetching and we use Kafka's
 * log reconciliation protocol to truncate the log to a common point following each leader
 * election.
 *
 * Like Zookeeper, this protocol distinguishes between voters and observers. Voters are
 * the only ones who are eligible to handle protocol requests and they are the only ones
 * who take part in elections.
 */
public final class KafkaRaftClient<T> implements RaftClient<T> {
    // ...
}
```

**Key features:**
- Leader election using VoteRequest/VoteResponse
- Log replication via **follower-driven fetch** (`not leader push!`)
- Snapshot support for faster bootstrap
- Pre-vote mechanism to reduce election disruption

### 3. ElectionState

**Location**: `raft/src/main/java/org/apache/kafka/raft/ElectionState.java`

Manages Raft election state persisted to disk.

From ElectionState.java:31:

```java
/**
 * Encapsulate election state stored on disk after every state change.
 */
public final class ElectionState {
    private final int epoch;
    private final OptionalInt leaderId;
    private final Optional<ReplicaKey> votedKey;
    // ...
}
```

**Persisted state:**
- Current epoch
- Voted candidate (with directory ID for fencing)
- Leader ID

This state is written to `quorum-state` file after every election event, ensuring crash recovery correctness.

### 4. Metadata Image & Delta

**Location**: `metadata/src/main/java/org/apache/kafka/image/`

- **MetadataImage**: Immutable snapshot of cluster state
- **MetadataDelta**: Changes to apply to create new image

**Design pattern:**
```
Old MetadataImage + MetadataDelta = New MetadataImage
```
This functional approach enables lock-free reads from image, safe concurrent access and an easy snapshot generation.

## Raft Election Protocol

KRaft uses a modified Raft election protocol optimized for Kafka's fetch-based replication.

### Election Flow

```
┌────────────────────────────────────────────────────────────┐
│ 1. Follower Election Timeout Expires                       │
│    (replica.fetch.timeout.ms)                              │
└────────────────────────────────────────────────────────────┘
                         │
                         ↓
┌───────── ───────────────────────────────────────────────────┐
│ 2. Transition to Candidate                                 │
│    - Increment epoch                                       │
│    - Vote for self                                         │
│    - Persist election state to quorum-state                │
└────────────────────────────────────────────────────────────┘
                         │
                         ↓
┌────────────────────────────────────────────────────────────┐
│ 3. Send VoteRequest to all voters                          │
│    Include:                                                │
│    - candidateEpoch                                        │
│    - candidateId                                           │
│    - lastOffsetEpoch (for log comparison)                  │
│    - lastOffset (for log comparison)                       │
└────────────────────────────────────────────────────────────┘
                         │
                         ↓
┌────────────────────────────────────────────────────────────┐
│ 4. Voters Grant or Reject Vote                             │
│    Grant if:                                               │
│    - candidateEpoch > local epoch                          │
│    - haven't voted in this epoch                           │
│    - candidate's log >= voter's log                        │
└────────────────────────────────────────────────────────────┘
                         │
                         ↓
┌────────────────────────────────────────────────────────────┐
│ 5. Candidate Receives Majority Votes                       │
│    → Becomes LEADER                                        │
└────────────────────────────────────────────────────────────┘
                         │
                         ↓
┌────────────────────────────────────────────────────────────┐
│ 6. Send BeginQuorumEpoch to all voters                     │
│    (Unlike standard Raft, explicit leader announcement)    │
└────────────────────────────────────────────────────────────┘
```

### Key Differences from Standard Raft

| Aspect               | Standard Raft              | Kafka Raft                    |
|----------------------|----------------------------|-------------------------------|
| **Replication**      | Leader pushes              | Follower pulls (fetch-based)  |
| **Leader Discovery** | Via AppendEntries          | Explicit BeginQuorumEpoch     |
| **Log Divergence**   | Leader truncates follower  | Follower truncates itself     |
| **Pre-vote**         | Optional (Raft extensions) | Built-in to reduce disruption |

**Why fetch-based?**
Kafka's existing replication infrastructure is fetch-driven. 
Reusing this model mainly reduces code duplication, allows followers to control fetch rate (backpressure).
Lastly, it simplifies integration with existing broker code.

## Metadata Log Replication

### The __cluster_metadata Topic

All cluster metadata is stored in a special internal topic:

```
Topic: __cluster_metadata
  Partitions: 1
  Replication Factor: 3 (or 5, matches controller quorum size)
  Leaders: Controller quorum voters only
```

### Metadata Record Types

From `QuorumController.java:1200+`, the replay mechanism handles:

```java
switch (type) {
    case REGISTER_BROKER_RECORD:
        clusterControl.replay((RegisterBrokerRecord) message, offset);
        break;
    case UNREGISTER_BROKER_RECORD:
        clusterControl.replay((UnregisterBrokerRecord) message);
        break;
    case TOPIC_RECORD:
        replicationControl.replay((TopicRecord) message);
        break;
    case PARTITION_RECORD:
        replicationControl.replay((PartitionRecord) message);
        break;
    case PARTITION_CHANGE_RECORD:
        replicationControl.replay((PartitionChangeRecord) message);
        break;
    case FENCE_BROKER_RECORD:
        clusterControl.replay((FenceBrokerRecord) message);
        break;
    case CONFIG_RECORD:
        configurationControl.replay((ConfigRecord) message);
        break;
    // ... 20+ more record types
}
```

**Common records:**
- `RegisterBrokerRecord`: Broker joins cluster
- `TopicRecord`: New topic created
- `PartitionRecord`: Partition configuration
- `PartitionChangeRecord`: ISR updates, leader changes
- `ConfigRecord`: Topic/broker configuration
- `FenceBrokerRecord`: Fence a broker (prevent operations)
- `UnfenceBrokerRecord`: Unfence a broker 

For those, who might not know when `FenceBrokerRecord` and `UnfenceBrokerRecord` occurs; 
`FenceBrokerRecord` happens when a broker misses heartbeats or during controlled shutdown, so `QuorumController` will replay with `fence` a broker.
On the other hand, when a broker successfully registers or resumes sending heartbeats after recovery then `QuorumController` will replay with `un-fence` a broker.

### Replay Mechanism

Both **active** and **standby** controllers replay the metadata log:

- **Standby controllers**: Replay to stay in sync, ready for failover
- **Active controller**: Also replays its own writes (state machine replication)

From `QuorumController.java:1012` (`handleLoadSnapshot`):

```java
@Override
public void handleLoadSnapshot(SnapshotReader<ApiMessageAndVersion> reader) {
    // ...
    offsetControl.beginLoadSnapshot(reader.snapshotId());
    while (reader.hasNext()) {
        Batch<ApiMessageAndVersion> batch = reader.next();
        for (ApiMessageAndVersion message : batch.records()) {
            replay(message.message(), Optional.of(reader.snapshotId()),
                    reader.lastContainedLogOffset());
        }
    }
    offsetControl.endLoadSnapshot(reader.lastContainedLogTimestamp());
    // ...
}
```

## Leader Election and Failover

### Becoming Active Controller: claim()

From `QuorumController.java:1114`:

```java
private void claim(int epoch, long newNextWriteOffset) {
    try {
        if (curClaimEpoch != -1) {
            throw new RuntimeException("Cannot claim leadership because we are already the " +
                    "active controller.");
        }
        curClaimEpoch = epoch;
        offsetControl.activate(newNextWriteOffset);
        clusterControl.activate();

        // Prepend the activate event. It is important that this event go at the beginning
        // of the queue rather than the end (hence prepend rather than append).
        ControllerWriteEvent<Void> activationEvent = new ControllerWriteEvent<>(
            "completeActivation[" + epoch + "]",
            new CompleteActivationEvent(),
            EnumSet.of(DOES_NOT_UPDATE_QUEUE_TIME)
        );
        queue.prepend(activationEvent);
    } catch (Throwable e) {
        fatalFaultHandler.handleFault("exception while claiming leadership", e);
    }
}
```

**Claim process is de-composed with the following steps:**
1. Set `curClaimEpoch` to prevent duplicate claims
2. Activate offset control (prepare to write)
3. Activate cluster control (ready to manage brokers)
4. Prepend activation event to event queue (runs before other events)
5. Generate activation records (e.g., fence/unfence brokers based on current state)

### Renouncing Leadership: renounce()

From `QuorumController.java:1164`:

```java
void renounce() {
    try {
        if (curClaimEpoch == -1) {
            throw new RuntimeException("Cannot renounce leadership because we are not the " +
                    "current leader.");
        }
        raftClient.resign(curClaimEpoch);
        curClaimEpoch = -1;
        deferredEventQueue.failAll(ControllerExceptions.
                newWrongControllerException(OptionalInt.empty()));
        offsetControl.deactivate();
        clusterControl.deactivate();
        periodicControl.deactivate();
    } catch (Throwable e) {
        fatalFaultHandler.handleFault("exception while renouncing leadership", e);
    }
}
```

**Renounce process is de-composed in these steps:**
1. Re-sign from Raft leadership (triggers new election)
2. Reset `curClaimEpoch` to -1
3. Fail all pending operations with "wrong controller" error
4. Deactivate all control subsystems
5. Stop periodic tasks (e.g., broker heartbeat checks)

## Snapshot Mechanism

### Why Snapshots?

Without snapshots, the metadata log grows unbounded. 
Replaying millions of records on startup is slow.

**Solution**: Periodic snapshots compress the log.

```
┌────────────────────────────────────────────────────────────┐
│ Metadata Log Timeline                                      │
│                                                            │
│  Offset: 0     1000   2000   3000   4000   5000   6000     │
│          │──────│──────│──────│──────│──────│──────│       │
│                 ↑                    ↑                     │
│           Snapshot-1000        Snapshot-4000               │
│                                                            │
│  Truncate log before Snapshot-1000 (cut)                   │
│  Replay from Snapshot-4000 (not offset 0)                  │
└────────────────────────────────────────────────────────────┘
```

### Snapshot Creation

Triggered when:
- Log size exceeds `metadata.log.max.record.bytes.between.snapshots` (default: 20MB)
- Active controller generates snapshot
- Standby controllers also generate snapshots to enable log truncation

**Snapshot contents:**
- Complete metadata image at a specific offset
- All broker registrations, topics, partitions, configs, ACLs, etc.
- Allows faster bootstrap for new controllers

### Snapshot Loading

When a controller starts:
1. Load latest snapshot (if exists)
2. Replay log from snapshot's last offset to current
3. Much faster than replaying from offset 0

## Broker Registration & Heartbeats

Brokers register with the controller and send periodic heartbeats.

### BrokerRegistration Flow

```
┌────────────┐                        ┌──────────────────┐
│  Broker    │                        │ Active Controller│
└────────────┘                        └──────────────────┘
      │                                        │
      │──── BrokerRegistrationRequest ────────>│
      │      (broker.id, endpoints,            │
      │       incarnationId, features)         │
      │                                        │
      │                                  [Generate broker
      │                                   epoch, write
      │                                   RegisterBrokerRecord]
      │                                        │
      │<──── BrokerRegistrationResponse ───────│
      │      (brokerEpoch)                     │
      │                                        │
      │──── BrokerHeartbeat (every 2s) ───────>│
      │      (brokerEpoch)                     │
      │                                        │
      │<──── HeartbeatResponse ────────────────│
      │      (isFenced, shouldShutDown)        │
      │                                        │
```

**Broker Epoch Fencing:**
- Each registration generates a new broker epoch
- Old incarnation's requests are rejected (epoch mismatch)
- Prevents split-brain when broker restarts

### BrokerHeartbeat Mechanism

- **Frequency**: Every 2 seconds (configurable)
- **Timeout**: If no heartbeat for 9 seconds, broker is fenced
- **Response includes**:
  - `isFenced`: Whether broker should stop serving requests
  - `shouldShutDown`: Signal for controlled shutdown

This is similar to ZooKeeper session tracking but integrated into Kafka's own protocol.

## Metadata Propagation to Brokers

### Pull-Based MetadataFetch

Unlike ZooKeeper's watch mechanism, KRaft uses **pull-based** metadata propagation:

```
┌─────────┐                          ┌──────────────────┐
│ Broker  │                          │ Active Controller│
└─────────┘                          └──────────────────┘
      │                                        │
      │                                  [Metadata change:
      │                                   partition leader
      │                                   changed, offset 5000]
      │                                        │
      │──── MetadataFetch(lastOffset=4500) ───>│
      │                                        │
      │<──── MetadataResponse ─────────────────│
      │      [Delta records: 4501-5000]        │
      │                                        │
      │  [Apply delta to local cache]          │
      │                                        │
```

**Benefits:**
- Broker controls fetch rate (backpressure)
- Delta-based updates (efficient)
- No ZooKeeper watches (simpler, more scalable)

### Local Metadata Cache

Each broker maintains:
- **MetadataImage**: Current cluster metadata
- **MetadataDelta**: Incoming changes from controller

**Update flow:**
1. Broker fetches delta from controller
2. Applies delta to local image
3. Notifies subsystems (partition manager, group coordinator, etc.)

## Key Design Patterns

### Single-Threaded Controller

QuorumController uses a **single event handler thread**:

```java
// From QuorumController architecture
EventQueue → Single Thread → Process Event → Write to Raft Log
```
That benefits that no locks are needed, the overall reasoning about state is easy, and finally there is deterministic event ordering.

### Futures-Based Async API

All controller operations return `CompletableFuture`:

```java
CompletableFuture<CreateTopicsResponseData> createTopics(CreateTopicsRequestData request);
```
Here benefits are that we have plenty of non-blocking for callers.
Moreover, there are multiple operations in flight and many more.

### Immutable Metadata Images

```java
MetadataImage oldImage = current();
MetadataDelta delta = new MetadataDelta(oldImage);
// ... apply changes to delta ...
MetadataImage newImage = delta.apply();
```
In many parts of whole codebase of Kafka we can find this pattern of `immutability` which gives us
(i.) lock-free reads, (ii.) safe concurrent access and (iii.) easy snapshot generation

## Monitoring KRaft Health

### Key Metrics

| Metric                        | Description                            | Alert Threshold       |
|-------------------------------|----------------------------------------|-----------------------|
| `ActiveControllerCount`       | Number of active controllers in quorum | Should be 1           |
| `LeaderElectionRateAndTimeMs` | Election frequency and duration        | >1/hour is concerning |
| `MetadataLogEndOffset`        | Current metadata log offset            | -                     |
| `MetadataLogLag`              | Standby controller lag                 | >1000 records         |
| `SnapshotGenerationTimeMs`    | Time to generate snapshot              | >10 seconds           |
| `MetadataErrorCount`          | Metadata application errors            | >0                    |

One could find all those metrics in the `QuorumControllerMetrics.java` class but also related class is `ControllerMetadataMetrics.java`.

### Common Issues

**Multiple Active Controllers:**
- Symptom: `ActiveControllerCount > 1`
- Cause: Split-brain due to network partition
- Action: Check network connectivity, investigate Raft logs

**Frequent Elections:**
- Symptom: High `LeaderElectionRateAndTimeMs`
- Cause: Controller instability, GC pauses, network issues
- Action: Tune JVM GC, check controller resource usage, investigate network

**High Metadata Log Lag:**
- Symptom: Standby controller `MetadataLogLag > 1000`
- Cause: Slow standby, network issues, disk performance
- Action: Check standby controller resources, disk I/O

**Snapshot Generation Failures:**
- Symptom: `SnapshotGenerationTimeMs` very high or `MetadataErrorCount > 0`
- Cause: Disk slow, corrupted metadata
- Action: Check disk performance, review logs for errors

## Summary

KRaft represents a fundamental shift in Kafka's architecture, replacing ZooKeeper with a built-in Raft-based consensus system. 
Key takeaways:
1. **Simplified Operations**: One system to manage instead of two
2. **Better Scalability**: Millions of partitions vs 200K with ZooKeeper
3. **Efficient Metadata**: Log-based replication with snapshots for compaction
4. **Single-Threaded Controller**: Simpler design, no complex locking
5. **Fetch-Based Replication**: Reuses Kafka's existing replication model
6. **Immutable Metadata Images**: Lock-free reads, safe concurrent access

The move to KRaft is one of the most significant architectural changes in Kafka's history, setting the foundation for the next decade of Kafka's evolution.

In the following post, we will apply the theoretical knowledge, we have gained in this blogpost and do another practical Kafka series.

---

*This series explores Apache Kafka's internal architecture at the code level. All references are to the Apache Kafka 4.1.0+ codebase.*