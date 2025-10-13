---
layout: post
title: "21 🔄 Kafka Internals #3: Replication Protocol & In-Sync Replicas Management"
date: 2025-10-13
categories: ["apache kafka", "distributed-systems", "replication"]
---

In previous posts, we explored [broker request processing](/2025/10/07/kafka-broker-request-processing) and [storage layer architecture](/2025/10/10/kafka-internals-storage-layer-and-log-segments). 
Today, we dive into Kafka's replication protocol (i.e., the mechanism that ensures data durability and availability across a distributed cluster).

## Overview

Kafka's replication protocol is a **leader-follower replication scheme** where each partition has:
- One **leader** replica that handles all reads and writes
- Multiple **follower** replicas that replicate data from the leader
- An **ISR (In-Sync Replicas)** set tracking which replicas are caught up

The protocol provides:
- **Linearizable writes** with configurable durability (`acks=all`)
- **High availability** through automatic leader failover
- **Strong consistency** guarantees for committed data
- **Tunable trade-offs** between latency, throughput, and durability

### CAP Theorem Trade-offs

Kafka's replication protocol navigates the [CAP theorem](https://en.wikipedia.org/wiki/CAP_theorem) by choosing **CP (Consistency + Partition tolerance)** over availability in the face of network partitions:

- **Consistency (C)**: Achieved through the ISR mechanism and high watermark. With `acks=all` and `min.insync.replicas > 1`, all committed data is guaranteed to be replicated to multiple brokers before acknowledgment.
- **Availability (A)**: Sacrificed when `ISR.size < min.insync.replicas`. In this scenario, Kafka rejects writes to maintain consistency guarantees.
- **Partition tolerance (P)**: Built-in through the distributed architecture. Kafka continues operating despite network partitions, but may become unavailable for writes if insufficient replicas remain in-sync.

**Configurable trade-off**: Setting `min.insync.replicas = 1` shifts toward AP (prioritizing availability), allowing writes as long as the leader is available, at the cost of potential data loss during leader failures.

## Key Components

### Core Classes

| Component             | Location                               | Purpose                                   |
|-----------------------|----------------------------------------|-------------------------------------------|
| Partition             | core/cluster/Partition.scala           | Manages per-partition replication state   |
| ReplicaManager        | core/server/ReplicaManager.scala       | Coordinates replication across partitions |
| ReplicaFetcherThread  | core/server/ReplicaFetcherThread.scala | Follower fetch mechanism                  |
| AlterPartitionManager | -                                      | Manages ISR change requests to controller |

### Replication Topology

```
┌─────────────────────────────────────────────────┐
│              Controller (KRaft)                 │
│  • Manages cluster metadata                     │
│  • Approves ISR changes via AlterPartition      │
│  • Elects leaders when needed                   │
└─────────────────────────────────────────────────┘
                ↑            ↓
          AlterPartition   LeaderAndIsr
                ↑            ↓
┌───────────────────────────────────────────────────┐
│           Partition: topic-0                      │
│  Leader: Broker 1                                 │
│  ISR: {1, 2, 3}                                   │
│  LEO: 1000    HW: 950                             │
│  ┌──────────────────────────────────────────────┐ │
│  │ LocalLog                                     │ │
│  │ [msg0...msg999]                              │ │
│  └──────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────┘
       ↓ Fetch (offset=950)   ↓ Fetch (offset=950)
┌──────────────────┐    ┌──────────────────┐
│ Follower Broker 2│    │ Follower Broker 3│
│ LEO: 950         │    │ LEO: 950         │
│ ISR member       │    │ ISR member       │
└──────────────────┘    └──────────────────┘
```

## High Watermark (HW) and Log End Offset (LEO)

### Definitions

**Log End Offset (LEO)**: The next offset to be written in a log
- Each replica maintains its own LEO
- Leader tracks LEO for all replicas via fetch requests

**High Watermark (HW)**: The maximum offset that is guaranteed to be replicated to all ISR members
- Marks the boundary of committed vs uncommitted data
- Consumers can only read up to HW (with `read_committed` isolation)
- HW = min(LEO of all ISR members)
- In other words it can be also described as **Upper Limit/Bound** offset for consumers to read.

### HW Advancement Logic

From Partition.scala:1159:

```scala
private def maybeIncrementLeaderHW(leaderLog: UnifiedLog, currentTimeMs: Long): Boolean = {
  if (isUnderMinIsr) {
    trace(s"Not increasing HWM because partition is under min ISR")
    return false
  }

  val leaderLogEndOffset = leaderLog.logEndOffsetMetadata
  var newHighWatermark = leaderLogEndOffset

  remoteReplicasMap.forEach { (_, replica) =>
    val replicaState = replica.stateSnapshot

    // Consider replica if it's in ISR or caught up and eligible to join
    if (replicaState.logEndOffsetMetadata.messageOffset < newHighWatermark.messageOffset &&
        (partitionState.maximalIsr.contains(replica.brokerId) ||
         shouldWaitForReplicaToJoinIsr)) {
      newHighWatermark = replicaState.logEndOffsetMetadata
    }
  }

  leaderLog.maybeIncrementHighWatermark(newHighWatermark).toScala match {
    case Some(oldHighWatermark) =>
      debug(s"High watermark updated from $oldHighWatermark to $newHighWatermark")
      true
    case None =>
      false
  }
}
```

**Key insights:**
- HW only advances if `ISR.size >= min.insync.replicas`
- Uses "maximal ISR" concept (includes pending additions) for safety
- New replicas joining ISR are waited on to prevent premature HW advancement

### High Watermark Propagation

```
┌─────────────────────────────────────────────────┐
│ Leader (Broker 1)                               │
│ LEO: 1000                                       │
│ HW: 950 (min of all ISR LEOs)                   │
└─────────────────────────────────────────────────┘
     │
     ├─ Fetch Request (from Broker 2)
     │  ↓ Response includes leader HW=950
┌────────────────────────┐
│ Follower (Broker 2)    │
│ LEO: 950               │
│ Updates local HW: 950  │
└────────────────────────┘
```

From ReplicaFetcherThread.scala:130:

```scala
log.maybeUpdateHighWatermark(partitionData.highWatermark).ifPresent { newHighWatermark =>
  maybeUpdateHighWatermarkMessage = s"and updated replica high watermark to $newHighWatermark"
  partitionsWithNewHighWatermark += topicPartition
}
```

## In-Sync Replicas (ISR)

### ISR Semantics

The ISR is the **dynamic set of replicas** that are:
1. Caught up to the leader's LEO (within `replica.lag.time.max.ms`)
2. Eligible to become leader (not fenced, not shutting down)
3. Have matching broker epochs

### ISR Expansion

A follower is added to ISR when:
1. Its LEO >= leader's HW
2. Its LEO >= leader epoch start offset
3. It's not fenced and not in controlled shutdown
4. Broker epoch matches (for fencing)

From Partition.scala:1056:

```scala
private def isFollowerInSync(followerReplica: Replica): Boolean = {
  leaderLogIfLocal.exists { leaderLog =>
    val followerEndOffset = followerReplica.stateSnapshot.logEndOffset
    followerEndOffset >= leaderLog.highWatermark &&
    leaderEpochStartOffsetOpt.exists(followerEndOffset >= _)
  }
}
```

**Why both conditions?**
- `followerEndOffset >= HW`: Ensures follower has all committed data
- `followerEndOffset >= leaderEpochStartOffset`: Prevents follower from joining ISR before catching up to current leader epoch's data

### ISR Shrinking

From Partition.scala:1282:

```scala
private def isFollowerOutOfSync(replicaId: Int,
                                leaderEndOffset: Long,
                                currentTimeMs: Long,
                                maxLagMs: Long): Boolean = {
  getReplica(replicaId).fold(true) { followerReplica =>
    !followerReplica.stateSnapshot.isCaughtUp(leaderEndOffset, currentTimeMs, maxLagMs)
  }
}
```

A replica is removed from ISR when:
- It hasn't fetched up to the leader's LEO within `replica.lag.time.max.ms`
- It's fenced or shutting down

**Two types of lag:**
1. **Stuck followers**: LEO hasn't updated for `maxLagMs`
2. **Slow followers**: Haven't caught up within `maxLagMs`

Both are handled by tracking `lastCaughtUpTimeMs` which represents the last time the replica was fully caught up.

## AlterPartition: ISR Change Protocol

### The Problem

Before [KIP-497](https://cwiki.apache.org/confluence/display/KAFKA/KIP-497%3A+Add+inter-broker+API+to+alter+ISR), ISR changes were written directly to ZooKeeper, causing:
- High ZK write load (100s of writes/sec)
- Frequent leadership changes during instability
- No transactional guarantees

### The Solution: AlterPartition Request

Leaders **propose** ISR changes to the controller via `AlterPartition` request:

```
┌──────────────────────────────────────────────────┐
│ Partition Leader (Broker 1)                     │
│  1. Detects follower caught up or lagging       │
│  2. Prepares new ISR state                      │
│  3. Optimistically updates local ISR            │
└──────────────────────────────────────────────────┘
           │
           ↓ AlterPartition(partitionEpoch, leaderEpoch, newISR, brokerEpochs)
┌──────────────────────────────────────────────────┐
│ Controller                                       │
│  1. Validates partition epoch                   │
│  2. Validates leader epoch                      │
│  3. Checks broker epochs (fencing)              │
│  4. Approves or rejects change                  │
└──────────────────────────────────────────────────┘
           │
           ↓ AlterPartitionResponse(success/failure, newPartitionEpoch)
┌──────────────────────────────────────────────────┐
│ Partition Leader (Broker 1)                     │
│  1. On success: commits ISR change locally      │
│  2. On failure: rolls back to last committed    │
└──────────────────────────────────────────────────┘
```

From Partition.scala:1754:

```scala
private def prepareIsrExpand(
  currentState: CommittedPartitionState,
  newInSyncReplicaId: Int
): PendingExpandIsr = {
  val isrToSend = partitionState.isr + newInSyncReplicaId
  val isrWithBrokerEpoch = addBrokerEpochToIsr(isrToSend.toList).asJava

  val newLeaderAndIsr = new LeaderAndIsr(
    localBrokerId,
    leaderEpoch,
    partitionState.leaderRecoveryState,
    isrWithBrokerEpoch,
    partitionEpoch
  )

  val updatedState = PendingExpandIsr(
    newInSyncReplicaId,
    newLeaderAndIsr,
    currentState
  )

  partitionState = updatedState  // Optimistic update
  updatedState
}
```

### Partition State Machine

```
┌─────────────────────────────┐
│ CommittedPartitionState     │
│ ISR: {1, 2, 3}              │
│ partitionEpoch: 42          │
│ isInflight: false           │
└─────────────────────────────┘
         │ ISR change detected
         ↓
┌─────────────────────────────┐
│ PendingExpandIsr/ShrinkIsr  │
│ maximalISR: {1, 2, 3, 4}    │  ← Used for HW calculation
│ committed ISR: {1, 2, 3}    │  ← Fallback on failure
│ isInflight: true            │
└─────────────────────────────┘
         │ AlterPartition response
         ↓
┌─────────────────────────────┐
│ CommittedPartitionState     │
│ ISR: {1, 2, 3, 4}           │
│ partitionEpoch: 43          │
│ isInflight: false           │
└─────────────────────────────┘
```

**Maximal ISR** (KIP-497):
- For ISR **expansion**: includes pending additions
- For ISR **shrinking**: excludes pending removals
- Used for HW advancement to maintain safety

This ensures:
- ISR expansions are **optimistic** (more restrictive, safer)
- ISR shrinks are **pessimistic** (wait for confirmation)

## Follower Fetch Protocol

### Fetch Thread Architecture

Each follower broker runs `ReplicaFetcherThread` instances to replicate from leaders:

```
┌─────────────────────────────────────────────┐
│ Follower Broker 2                           │
│                                             │
│  ReplicaFetcherManager                      │
│    ├─ FetcherThread-1 → Leader Broker 1    │
│    │   └─ Partitions: {topic-0, topic-1}   │
│    └─ FetcherThread-2 → Leader Broker 3    │
│        └─ Partitions: {topic-2, topic-3}   │
└─────────────────────────────────────────────┘
```

### Fetch Loop

From ReplicaFetcherThread.scala:100:

```scala
override def processPartitionData(
  topicPartition: TopicPartition,
  fetchOffset: Long,
  partitionLeaderEpoch: Int,
  partitionData: FetchData
): Option[LogAppendInfo] = {
  val partition = replicaMgr.getPartitionOrException(topicPartition)
  val log = partition.localLogOrException
  val records = toMemoryRecords(FetchResponse.recordsOrFail(partitionData))

  // Sanity check: fetch offset should match LEO
  if (fetchOffset != log.logEndOffset)
    throw new IllegalStateException(s"Offset mismatch for $topicPartition")

  // Append to local log
  val logAppendInfo = partition.appendRecordsToFollowerOrFutureReplica(
    records,
    isFuture = false,
    partitionLeaderEpoch
  )

  // Update high watermark from leader
  log.maybeUpdateHighWatermark(partitionData.highWatermark).ifPresent { newHW =>
    partitionsWithNewHighWatermark += topicPartition
  }

  logAppendInfo
}
```

**Key steps:**
1. Fetch records from leader starting at local LEO
2. Validate offset consistency
3. Append to local log
4. Update local HW from leader's HW in fetch response
5. Track partitions with new HW to complete delayed fetch requests

### Truncation on Divergence

When a follower's log diverges from the leader (e.g., after leader failover), it must truncate:

From ReplicaFetcherThread.scala:165:

```scala
override def truncate(tp: TopicPartition, offsetTruncationState: OffsetTruncationState): Unit = {
  val partition = replicaMgr.getPartitionOrException(tp)
  partition.truncateTo(offsetTruncationState.offset, isFuture = false)

  // Mark future replica for truncation if this is the last truncation
  if (offsetTruncationState.truncationCompleted)
    replicaMgr.replicaAlterLogDirsManager.markPartitionsForTruncation(
      brokerConfig.brokerId,
      tp,
      offsetTruncationState.offset
    )
}
```

**Divergence detection:**
1. Follower sends `lastFetchedEpoch` in fetch request
2. Leader checks if its log at that epoch has diverged
3. If diverged, leader returns `divergingEpoch` in response
4. Follower truncates to the divergence point

## Leader Election

### Election Triggers

Leader election occurs when:
- Current leader fails (broker crash, network partition)
- Current leader is fenced (controller detects staleness)
- Manual leadership transfer (preferred leader election)

### Election Process

```
┌────────────────────────────────────────────┐
│ Controller detects leader failure          │
└────────────────────────────────────────────┘
         │
         ↓
┌────────────────────────────────────────────┐
│ Select new leader from ISR                 │
│ Priority: First replica in ISR             │
└────────────────────────────────────────────┘
         │
         ↓
┌────────────────────────────────────────────┐
│ Increment partition epoch                  │
│ Increment leader epoch                     │
└────────────────────────────────────────────┘
         │
         ↓
┌────────────────────────────────────────────┐
│ Send LeaderAndIsr to all replicas          │
│ (via metadata log in KRaft)                │
└────────────────────────────────────────────┘
         │
         ↓
┌────────────────────────────────────────────┐
│ New leader: makeLeader()                   │
│ Followers: makeFollower()                  │
└────────────────────────────────────────────┘
```

### makeLeader Transition

From Partition.scala:736:

```scala
def makeLeader(partitionRegistration: PartitionRegistration,
               isNew: Boolean,
               highWatermarkCheckpoints: OffsetCheckpoints,
               topicId: Option[Uuid]): Boolean = {
  val (leaderHWIncremented, isNewLeader) = inWriteLock(leaderIsrUpdateLock) {
    // Validate partition epoch
    if (partitionRegistration.partitionEpoch < partitionEpoch) {
      stateChangeLogger.info(s"Skipped become-leader for $topicPartition since " +
        s"partition epoch ${partitionRegistration.partitionEpoch} < current $partitionEpoch")
      return false
    }

    val isNewLeader = !isLeader
    val isNewLeaderEpoch = partitionRegistration.leaderEpoch > leaderEpoch

    // Update ISR and assignment
    updateAssignmentAndIsr(
      replicas = partitionRegistration.replicas,
      isLeader = true,
      isr = partitionRegistration.isr.toSet,
      ...
    )

    createLogIfNotExists(...)
    val leaderLog = localLogOrException

    if (isNewLeaderEpoch) {
      val leaderEpochStartOffset = leaderLog.logEndOffset
      leaderLog.assignEpochStartOffset(partitionRegistration.leaderEpoch, leaderEpochStartOffset)

      // Reset replica states
      remoteReplicas.foreach { replica =>
        replica.resetReplicaState(currentTimeMs, leaderEpochStartOffset, ...)
      }

      leaderEpoch = partitionRegistration.leaderEpoch
      leaderEpochStartOffsetOpt = Some(leaderEpochStartOffset)
    }

    partitionEpoch = partitionRegistration.partitionEpoch
    leaderReplicaIdOpt = Some(localBrokerId)

    (maybeIncrementLeaderHW(leaderLog), isNewLeader)
  }

  if (leaderHWIncremented)
    tryCompleteDelayedRequests()

  isNewLeader
}
```

**Critical points:**
1. **Epoch validation**: Rejects stale metadata
2. **Leader epoch start offset**: Cached to help followers truncate correctly
3. **Replica state reset**: All followers start with unknown LEO
4. **HW advancement**: May immediately advance if ISR size >= minISR

## Durability Guarantees

### Producer Acknowledgment Semantics

| `acks` | Behavior                | Durability                                    | Latency |
|--------|-------------------------|-----------------------------------------------|---------|
| `0`    | Fire-and-forget         | None                                          | Lowest  |
| `1`    | Leader appends to log   | Leader crash loses data                       | Medium  |
| `all`  | All ISR replicas append | No data loss (with `min.insync.replicas > 1`) | Highest |

From Partition.scala:1368:

```scala
def appendRecordsToLeader(records: MemoryRecords,
                         origin: AppendOrigin,
                         requiredAcks: Int,
                         requestLocal: RequestLocal): LogAppendInfo = {
  val (info, leaderHWIncremented) = inReadLock(leaderIsrUpdateLock) {
    leaderLogIfLocal match {
      case Some(leaderLog) =>
        val minIsr = effectiveMinIsr(leaderLog)
        val inSyncSize = partitionState.isr.size

        // Check min.insync.replicas for acks=all
        if (inSyncSize < minIsr && requiredAcks == -1) {
          throw new NotEnoughReplicasException(
            s"ISR size $inSyncSize < min.isr $minIsr for partition $topicPartition")
        }

        val info = leaderLog.appendAsLeader(records, this.leaderEpoch, origin, ...)
        (info, maybeIncrementLeaderHW(leaderLog))

      case None =>
        throw new NotLeaderOrFollowerException(...)
    }
  }

  info.copy(if (leaderHWIncremented) LeaderHwChange.INCREASED else LeaderHwChange.SAME)
}
```

### Delayed Produce (acks=all)

When `acks=all`, the response is delayed until:
1. All ISR replicas have fetched the data (LEO >= requiredOffset), OR
2. Timeout expires (`request.timeout.ms`)

From Partition.scala:1096:

```scala
def checkEnoughReplicasReachOffset(requiredOffset: Long): (Boolean, Errors) = {
  leaderLogIfLocal match {
    case Some(leaderLog) =>
      val curMaximalIsr = partitionState.maximalIsr
      val minIsr = effectiveMinIsr(leaderLog)

      if (leaderLog.highWatermark >= requiredOffset) {
        // HW advanced - all ISR replicas have the data
        if (minIsr <= curMaximalIsr.size)
          (true, Errors.NONE)
        else
          (true, Errors.NOT_ENOUGH_REPLICAS_AFTER_APPEND)
      } else {
        (false, Errors.NONE)  // Still waiting
      }

    case None =>
      (false, Errors.NOT_LEADER_OR_FOLLOWER)
  }
}
```

The purgatory pattern ensures:
- Handler threads don't block waiting for replication
- Responses sent immediately when replicas catch up
- Timeouts handled gracefully

## Replica Fencing with Broker Epochs

### The Problem

Without fencing, zombie brokers (network-partitioned but still running) could:
- Continue accepting writes as leader
- Corrupt data after a new leader is elected
- Cause split-brain scenarios

**Split-brain example**:
```
1. Broker 1 is leader for partition topic-0
2. Network partition isolates Broker 1 from the controller
3. Controller elects Broker 2 as new leader (increments partition epoch)
4. Without fencing:
   ├─ Broker 1 (zombie): Still thinks it's leader, accepts writes at offset 1000+
   └─ Broker 2 (new leader): Also accepts writes at offset 1000+
5. Result: Two divergent logs with different data at same offsets
6. When partition heals: Data corruption, inconsistent replicas
```

With broker epoch fencing, Broker 1's writes are rejected because its broker epoch is stale, preventing the split-brain.

### The Solution: Broker Epochs

Each broker maintains a monotonically increasing **broker epoch**:
- Incremented on every registration with controller
- Sent with every fetch request
- Validated during ISR changes

From Partition.scala:1063:

```scala
private def isReplicaIsrEligible(followerReplicaId: Int): Boolean = {
  val mayBeReplica = getReplica(followerReplicaId)
  if (mayBeReplica.isEmpty) return false

  val storedBrokerEpoch = mayBeReplica.get.stateSnapshot.brokerEpoch
  val cachedBrokerEpoch = metadataCache.getAliveBrokerEpoch(followerReplicaId)

  !metadataCache.isBrokerFenced(followerReplicaId) &&
  !metadataCache.isBrokerShuttingDown(followerReplicaId) &&
  isBrokerEpochIsrEligible(storedBrokerEpoch, cachedBrokerEpoch)
}
```

**Fencing flow:**
1. Broker crashes and restarts
2. Broker re-registers with controller, gets new broker epoch
3. Old fetch requests (with old broker epoch) are rejected
4. Replica cannot join ISR until broker epochs match

## Configuration Tuning

### Replication Factor

```
replication.factor = 3  # Tolerates 2 failures with min.insync.replicas=2
```

**Trade-offs:**
- Higher RF → More durability, higher storage cost, higher replication overhead
- Typical: RF=3 for production, RF=1 for development

### min.insync.replicas

```
min.insync.replicas = 2  # With RF=3, tolerates 1 failure
```

**Formula**: `min.insync.replicas = f + 1` where `f` = number of tolerable failures

**Impact:**
- Affects write availability (requires minISR replicas to accept writes)
- Affects HW advancement (HW only advances if ISR >= minISR)

### replica.lag.time.max.ms

```
replica.lag.time.max.ms = 30000  # 30 seconds
```

**Meaning**: Maximum time a follower can be out of sync before removal from ISR

**Considerations:**
- Too low → ISR thrashing during transient slowness
- Too high → Delayed detection of failed replicas

### unclean.leader.election.enable

```
unclean.leader.election.enable = false  # Default: prioritize consistency
```

**When `true`**: Allows out-of-sync replicas to become leader
**Risk**: Potential data loss, non-monotonic HW

**Use case**: Prefer availability over consistency (rare) (i.e., moving to AP over CP => CAP Theorem)

## KIP-966: Enhanced Durability with ELR

**[KIP-966](https://issues.apache.org/jira/browse/KAFKA-15579)** introduces **Eligible Leader Replicas (ELR)** to address the "last replica standing" problem. 
This feature was added in Kafka 4.0 (preview) and enabled by default for new clusters in Kafka 4.1.

### The Problem

With traditional ISR:
1. ISR = {1, 2, 3}, minISR = 2
2. Replica 3 lags and is removed → ISR = {1, 2}
3. Replica 2 fails → ISR = {1}
4. If Replica 1 fails, partition becomes unavailable (no ISR member)

### The Solution: ELR

ELR is a "safety net" containing replicas that:
- Were removed from ISR
- Still host the complete committed log
- Are managed by the controller

**Election priority:**
1. Select from ISR (if available)
2. Select from ELR (if ISR empty)
3. Unclean election (if both empty and enabled)

**Benefits:**
- Reduces data loss risk
- Maintains availability during cascading failures
- Provides recovery quorum

## Monitoring ISR Health

### Key Metrics

| Metric                      | Meaning                        | Alert Threshold    |
|-----------------------------|--------------------------------|--------------------|
| `UnderReplicatedPartitions` | Partitions with replicas < RF  | > 0                |
| `OfflinePartitionsCount`    | Partitions with no leader      | > 0                |
| `UnderMinIsrPartitionCount` | ISR < minISR                   | > 0                |
| `IsrExpandsPerSec`          | ISR additions/sec              | High variance      |
| `IsrShrinksPerSec`          | ISR removals/sec               | Sustained increase |
| `FailedIsrUpdatesPerSec`    | Failed AlterPartition requests | > 0                |

From ReplicaManager.scala:312:

```scala
val isrExpandRate: Meter = metricsGroup.newMeter("IsrExpandsPerSec", "expands", TimeUnit.SECONDS)
val isrShrinkRate: Meter = metricsGroup.newMeter("IsrShrinksPerSec", "shrinks", TimeUnit.SECONDS)
val failedIsrUpdatesRate: Meter = metricsGroup.newMeter("FailedIsrUpdatesPerSec", "failedUpdates", TimeUnit.SECONDS)
```

### Common ISR Issues

**ISR Thrashing:**
- Symptom: High `IsrExpandsPerSec` and `IsrShrinksPerSec`
- Causes: Network instability, GC pauses, slow disks
- Solution: Increase `replica.lag.time.max.ms`, investigate broker performance

**Persistent UnderMinIsr:**
- Symptom: Sustained `UnderMinIsrPartitionCount > 0`
- Causes: Broker failures, disk failures, network partitions
- Solution: Replace failed brokers, check partition reassignment

**Failed ISR Updates:**
- Symptom: `FailedIsrUpdatesPerSec > 0`
- Causes: Controller unavailable, partition epoch conflicts
- Solution: Check controller health, investigate metadata log

## Summary

Kafka's replication protocol achieves strong durability and availability through:

1. **Leader-follower architecture** with dynamic ISR tracking
2. **High watermark mechanism** for committed data safety
3. **AlterPartition protocol** for transactional ISR changes with controller validation
4. **Broker epoch fencing** to prevent split-brain scenarios
5. **Configurable trade-offs** between latency, throughput, and durability
6. **Delayed produce pattern** for efficient `acks=all` handling

The protocol's key innovation is the **separation of replication (ISR) from availability (leader election)**, allowing Kafka to maintain strong consistency while providing high availability through automatic failover.

In the next post, we'll explore **consumer groups and coordination** (i.e., how Kafka manages consumer group membership, partition assignment, and offset commits).

---

*This series explores Apache Kafka's internal architecture at the code level. All references are to the Apache Kafka 4.1.0+ codebase.*