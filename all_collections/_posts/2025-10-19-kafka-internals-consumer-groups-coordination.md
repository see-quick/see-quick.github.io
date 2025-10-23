---
layout: post
title: "23 🤝 Kafka Internals #4: Consumer Groups & Coordination Protocol"
date: 2025-10-19
categories: ["apache-kafka", "distributed-systems", "coordination", "consumer-groups"]
---

In previous posts, we explored [broker request processing](/posts/kafka-internals-broker-request-processing), [storage layer architecture](/posts/kafka-internals-storage-layer-and-log-segments), and the [replication protocol](/posts/kafka-internals-replication-protocol). 
Today, we dive into how Kafka manages consumer group membership, partition assignment, and offset commits.

## Overview

Kafka's consumer group protocol enables **distributed consumption** where multiple consumers coordinate to consume partitions in parallel. 
The protocol provides:

- **Automatic partition assignment**: Partitions distributed among active consumers
- **Rebalancing**: Dynamic membership changes trigger reassignment
- **Exactly-once semantics**: Coordinated offset commits prevent duplicate/lost messages
- **Failure detection**: Heartbeat mechanism detects crashed consumers

### Key Guarantees

1. **Each partition consumed by exactly one consumer** in a group (exclusive assignment)
2. **At-least-once delivery** by default (with proper offset management)
3. **Exactly-once semantics** when using transactional reads (`isolation.level=read_committed`)
4. **Automatic failover** when consumers join/leave

## Core Components

### Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                  Kafka Cluster                          │
│                                                         │
│  ┌──────────────────────────────────────────────────┐   │
│  │ Group Coordinator (Broker 1)                     │   │
│  │  • Manages consumer group "my-group"             │   │
│  │  • Stores state in __consumer_offsets            │   │
│  │  • Handles rebalancing                           │   │
│  │  • Tracks heartbeats                             │   │
│  └──────────────────────────────────────────────────┘   │
│         ↕ JoinGroup / SyncGroup / Heartbeat             │
│  ┌──────────────────────────────────────────────────┐   │
│  │ Partition: __consumer_offsets-X                  │   │
│  │  Key: (group.id, topic, partition)               │   │
│  │  Value: (offset, metadata, timestamp)            │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
          ↕                    ↕                    ↕
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│ Consumer 1       │  │ Consumer 2       │  │ Consumer 3       │
│ Group: my-group  │  │ Group: my-group  │  │ Group: my-group  │
│ Assigned: [0,1]  │  │ Assigned: [2,3]  │  │ Assigned: [4,5]  │
│ Generation: 5    │  │ Generation: 5    │  │ Generation: 5    │
└──────────────────┘  └──────────────────┘  └──────────────────┘
```

### Core Classes

| Component            | Location                                          | Purpose                                    |
|----------------------|---------------------------------------------------|--------------------------------------------|
| GroupCoordinator     | coordinator/group/GroupCoordinator.scala          | Manages consumer group lifecycle           |
| GroupMetadataManager | coordinator/group/GroupMetadataManager.scala      | Persists group state to __consumer_offsets |
| KafkaConsumer        | clients/src/.../consumer/KafkaConsumer.java       | Client-side consumer implementation        |
| ConsumerCoordinator  | clients/src/.../consumer/ConsumerCoordinator.java | Client-side coordination protocol          |
| PartitionAssignor    | clients/src/.../consumer/PartitionAssignor.java   | Assignment strategy interface              |

## Consumer Group Lifecycle

### States and Transitions

A consumer group progresses through these states (showing the **happy path** - additional transitions exist for error cases and group deletion):

```
        Empty
          │
          ↓ First consumer joins
    PreparingRebalance ←─────────┐
          │                      │
          ↓ All members joined   │
  CompletingRebalance            │
          │                      │
          ↓ Leader sends         │
        Stable ──────────────────┘
             Consumer leaves/crashes
```

**Additional transitions** (not shown above):
- **PreparingRebalance → Empty**: All members leave during rebalance
- **CompletingRebalance → PreparingRebalance**: Member joins/leaves while waiting for assignment
- **Any state → Dead**: Group deletion (partition emigration or admin operation)

### Group Coordinator Selection

Each consumer group is managed by exactly one coordinator, determined by:

```java
// From GroupCoordinatorService.java:394
public int partitionFor(String groupId) {
    return Utils.abs(groupId.hashCode()) % numPartitions;
}
```

Where `numPartitions` is the number of partitions in the `__consumer_offsets` topic. 
The coordinator is the **leader** of the `__consumer_offsets` partition for that group.

**Example:**
```
groupId = "my-app"
groupId.hashCode = 1234567
__consumer_offsets partitions = 50

coordinator partition = abs(1234567) % 50 = 17
coordinator broker = leader of __consumer_offsets-17
```

This ensures:
- Deterministic coordinator selection
- Load distribution across brokers
- Automatic failover (if coordinator broker fails, partition leader election picks new coordinator)

## Rebalancing Protocol

### The Join-Sync Dance

Rebalancing follows a **two-phase protocol**:

#### Phase 1: JoinGroup (Member Discovery)

```
┌──────────────┐  JoinGroup(group.id, member.id="")   ┌──────────────────┐
│ Consumer 1   │ ──────────────────────────────────→  │                  │
└──────────────┘                                      │                  │
                                                      │  Coordinator     │
┌──────────────┐  JoinGroup(group.id, member.id="")   │                  │
│ Consumer 2   │ ──────────────────────────────────→  │  State:          │
└──────────────┘                                      │  PreparingReb... │
                                                      │                  │
┌──────────────┐  JoinGroup(group.id, member.id="")   │  Waiting for     │
│ Consumer 3   │ ──────────────────────────────────→  │  session.timeout │
└──────────────┘                                      │  or all members  │
                                                      └──────────────────┘
                    ↓ Timeout or all members joined

┌──────────────┐  ← JoinResponse(generation=5, leader=C1, members=[C1,C2,C3])
│ Consumer 1   │
│ (Leader)     │
└──────────────┘

┌──────────────┐  ← JoinResponse(generation=5, leader=C1, members=[])
│ Consumer 2   │
│ (Follower)   │
└──────────────┘

┌──────────────┐  ← JoinResponse(generation=5, leader=C1, members=[])
│ Consumer 3   │
│ (Follower)   │
└──────────────┘
```

From `GroupMetadataManager.java:6142`:

```java
public CoordinatorResult<Void, CoordinatorRecord> classicGroupJoin(
    AuthorizableRequestContext context,
    JoinGroupRequestData request,
    CompletableFuture<JoinGroupResponseData> responseFuture
) {
    Group group = groups.get(request.groupId(), Long.MAX_VALUE);
    if (group != null) {
        if (group.type() == CONSUMER && !group.isEmpty()) {
            return classicGroupJoinToConsumerGroup((ConsumerGroup) group, context, request, responseFuture);
        } else if (group.type() == CONSUMER || group.type() == CLASSIC || group.type() == STREAMS && group.isEmpty()) {
            return classicGroupJoinToClassicGroup(context, request, responseFuture);
        } else {
            responseFuture.complete(new JoinGroupResponseData()
                .setMemberId(UNKNOWN_MEMBER_ID)
                .setErrorCode(Errors.INCONSISTENT_GROUP_PROTOCOL.code())
            );
            return EMPTY_RESULT;
        }
    } else {
        return classicGroupJoinToClassicGroup(context, request, responseFuture);
    }
}
```

**Key points:**
- **First joiner** becomes the **leader** (selects assignment strategy)
- Leader receives full member list and metadata
- Followers receive only generation ID
- Coordinator assigns a unique `member.id` to each consumer

#### Phase 2: SyncGroup (Assignment Distribution)

```
┌──────────────┐
│ Consumer 1   │  Computes assignment using RangeAssignor/RoundRobinAssignor
│ (Leader)     │  assignment = {C1: [p0,p1], C2: [p2,p3], C3: [p4,p5]}
└──────────────┘
       │
       ↓ SyncGroup(generation=5, assignment={...})
┌──────────────────┐
│   Coordinator    │  Stores assignment
└──────────────────┘
       ↓
       ↓ SyncResponse(assignment=[p0,p1])  ┌──────────────┐
       └────────────────────────────────→  │ Consumer 1   │
                                           └──────────────┘
       ↓ SyncResponse(assignment=[p2,p3])  ┌──────────────┐
       └────────────────────────────────→  │ Consumer 2   │
                                           └──────────────┘
       ↓ SyncResponse(assignment=[p4,p5])  ┌──────────────┐
       └────────────────────────────────→  │ Consumer 3   │
                                           └──────────────┘
```

From `GroupMetadataManager.java:7381`:

```java
public CoordinatorResult<Void, CoordinatorRecord> classicGroupSync(
    AuthorizableRequestContext context,
    SyncGroupRequestData request,
    CompletableFuture<SyncGroupResponseData> responseFuture
) {
    Group group;
    try {
        group = group(request.groupId());
    } catch (GroupIdNotFoundException e) {
        responseFuture.complete(new SyncGroupResponseData()
            .setErrorCode(Errors.UNKNOWN_MEMBER_ID.code()));
        return EMPTY_RESULT;
    }

    if (group.type() == CLASSIC) {
        return classicGroupSyncToClassicGroup((ClassicGroup) group, context, request, responseFuture);
    } else if (group.type() == CONSUMER) {
        return classicGroupSyncToConsumerGroup((ConsumerGroup) group, request, responseFuture);
    } else {
        responseFuture.complete(new SyncGroupResponseData()
            .setErrorCode(Errors.UNKNOWN_MEMBER_ID.code()));
        return EMPTY_RESULT;
    }
}
```

### Rebalancing Triggers

Rebalancing is triggered when:

1. **Consumer joins** (new member or existing member rejoins after crash)
2. **Consumer leaves** (graceful shutdown via `LeaveGroup`)
3. **Consumer crashes** (detected via heartbeat timeout)
4. **Subscription changes** (consumer changes topic subscriptions)
5. **Partition count changes** (new partitions added to subscribed topics)

From `GroupMetadataManager.java:6946`:

```java
CoordinatorResult<Void, CoordinatorRecord> prepareRebalance(
    ClassicGroup group,
    String reason
) {
    // If any members are awaiting sync, cancel their request and have them rejoin.
    if (group.isInState(COMPLETING_REBALANCE)) {
        resetAndPropagateAssignmentWithError(group, Errors.REBALANCE_IN_PROGRESS);
    }

    // If a sync expiration is pending, cancel it.
    removeSyncExpiration(group);

    group.transitionTo(PREPARING_REBALANCE);

    log.info("Preparing to rebalance group {} in state {} with old generation {} (reason: {}).",
        group.groupId(),
        group.currentState(),
        group.generationId(),
        reason);

    return EMPTY_RESULT;
}
```

### Generation ID and Fencing

Each rebalance increments the **generation ID**, which serves as an **epoch** to fence stale consumers:

```java
// From ClassicGroup.java:1289
public void initNextGeneration() {
    generationId++;
    if (!members.isEmpty()) {
        setProtocolName(Optional.of(selectProtocol()));
        subscribedTopics = computeSubscribedTopics();
        transitionTo(COMPLETING_REBALANCE);
    } else {
        setProtocolName(Optional.empty());
        subscribedTopics = computeSubscribedTopics();
        transitionTo(EMPTY);
    }
    clearPendingSyncMembers();
}
```

**Fencing Example:**
```
1. Consumer C1 assigned partition 0 in generation 5
2. Network partition isolates C1
3. Coordinator triggers rebalance → generation 6
4. Consumer C2 assigned partition 0 in generation 6
5. C1 reconnects and tries to commit offset for partition 0
   → Rejected with ILLEGAL_GENERATION error
   → C1 must rejoin and get new assignment
```

This prevents **zombie consumers** from committing offsets for partitions they no longer own.

## Partition Assignment Strategies

### Built-in Strategies

Kafka provides three built-in assignment strategies:

#### 1. Range Assignor

**Algorithm:** Assign partitions **per topic** in sequential ranges.

From `RangeAssignor.java:148`:

```java
// Simplified algorithm (actual implementation includes rack-aware assignment):
// 1. For each topic independently:
//    - Sort consumers lexicographically
//    - Sort partitions numerically
//    - Divide partitions evenly: numPartitions / numConsumers
//    - First (numPartitions % numConsumers) consumers get one extra partition

public Map<String, List<TopicPartition>> assign(
    Map<String, Integer> partitionsPerTopic,
    Map<String, Subscription> subscriptions) {
    return assignPartitions(partitionInfosWithoutRacks(partitionsPerTopic), subscriptions);
}
```

**Example:**
```
Topic: topic-A (10 partitions), topic-B (10 partitions)
Consumers: C1, C2, C3

Assignment:
  C1: topic-A[0,1,2,3], topic-B[0,1,2,3]  (8 partitions)
  C2: topic-A[4,5,6], topic-B[4,5,6]      (6 partitions)
  C3: topic-A[7,8,9], topic-B[7,8,9]      (6 partitions)
```

**Issue:** Can lead to **imbalanced assignment** when consuming multiple topics.

#### 2. RoundRobin Assignor

**Algorithm:** Distribute partitions **across all topics** in a round-robin fashion.

From `RoundRobinAssignor.java:104`:

```java
// Simplified algorithm:
// 1. Sort all partitions across all topics alphabetically
// 2. Sort all consumers alphabetically
// 3. Use circular iterator to assign partitions round-robin to consumers
//    (skipping consumers not subscribed to that partition's topic)

public Map<String, List<TopicPartition>> assign(
    Map<String, Integer> partitionsPerTopic,
    Map<String, Subscription> subscriptions) {

    CircularIterator<MemberInfo> assigner = new CircularIterator<>(Utils.sorted(memberInfoList));

    for (TopicPartition partition : allPartitionsSorted(partitionsPerTopic, subscriptions)) {
        // Skip to next consumer subscribed to this topic
        while (!subscriptions.get(assigner.peek().memberId).topics().contains(partition.topic()))
            assigner.next();
        assignment.get(assigner.next().memberId).add(partition);
    }
    return assignment;
}
```

**Example:**
```
Topic: topic-A (5 partitions), topic-B (5 partitions)
Consumers: C1, C2, C3

Sorted partitions: [A-0, A-1, A-2, A-3, A-4, B-0, B-1, B-2, B-3, B-4]

Assignment (round-robin):
  C1: A-0, A-3, B-1, B-4  (4 partitions)
  C2: A-1, A-4, B-2       (3 partitions)
  C3: A-2, B-0, B-3       (3 partitions)
```

**Better balance** across consumers, but can cause more **partition movement** during rebalancing.

#### 3. Sticky Assignor

**Algorithm:** Minimize partition movement during rebalancing while maintaining balance.

**Goals:**
1. **Balanced assignment** (like RoundRobin)
2. **Minimize partition reassignment** when members join/leave (preserve existing assignments where possible)

From `AbstractStickyAssignor.java:118` (parent class of StickyAssignor):

```java
// Simplified algorithm:
// 1. Extract previous partition assignments from member metadata (owned partitions)
// 2. If all consumers subscribe to same topics:
//    - Use ConstrainedAssignmentBuilder (optimized algorithm)
//    - Preserves existing assignments where possible
// 3. Otherwise:
//    - Use GeneralAssignmentBuilder
//    - Compute sticky assignment from scratch
// 4. Balance unassigned partitions across consumers while minimizing movement

public Map<String, List<TopicPartition>> assign(
    Map<String, Integer> partitionsPerTopic,
    Map<String, Subscription> subscriptions) {

    AbstractAssignmentBuilder assignmentBuilder;
    if (allSubscriptionsEqual(partitionsPerTopic.keySet(), subscriptions, /*...*/)) {
        assignmentBuilder = new ConstrainedAssignmentBuilder(/* preserve assignments */);
    } else {
        assignmentBuilder = new GeneralAssignmentBuilder(/* recompute */);
    }
    return assignmentBuilder.build();
}
```

**Example (rebalance scenario):**
```
Initial state (3 consumers):
  C1: [A-0, A-1, B-0]
  C2: [A-2, A-3, B-1]
  C3: [A-4, B-2, B-3]

C2 leaves → triggers rebalance

RoundRobin would produce:
  C1: [A-0, A-2, B-0, B-2]  ← 3 new partitions (A-2, B-0, B-2)
  C3: [A-1, A-3, A-4, B-1, B-3]  ← 3 new partitions

StickyAssignor produces:
  C1: [A-0, A-1, B-0, A-2]  ← 1 new partition (A-2)
  C3: [A-4, B-2, B-3, A-3, B-1]  ← 2 new partitions (A-3, B-1)

Partition movement: 3 instead of 6
```

**Benefits:**
- Reduces **consumer-side state rebuilding** (caches, offset windows, etc.)
- Lowers **rebalancing latency**
- Maintains **balance** across consumers

### Cooperative Rebalancing (Incremental)

**Problem with Eager Rebalancing:**
- During rebalance, **all consumers stop consuming**
- Causes **consumption lag spike**
- Entire partition set reassigned, even if only one consumer joins/leaves

**Solution: Cooperative (Incremental) Rebalancing** ([KIP-429](https://cwiki.apache.org/confluence/display/KAFKA/KIP-429%3A+Kafka+Consumer+Incremental+Rebalance+Protocol))

**Key idea:** Only revoke partitions that need to be reassigned.

```
Traditional Eager Rebalancing:
  C1: [p0, p1, p2] → revoke all → stop consuming
  C2: [p3, p4, p5] → revoke all → stop consuming
  C3 joins
  ↓ rebalance
  C1: [p0, p1] ← resume consuming
  C2: [p2, p3] ← resume consuming
  C3: [p4, p5] ← resume consuming

  Total consumption pause: ~2-5 seconds for all partitions

Cooperative Rebalancing:
  C1: [p0, p1, p2] → continue consuming p0, p1
  C2: [p3, p4, p5] → continue consuming p3, p4
  C3 joins
  ↓ rebalance (incremental)
  C1 revokes p2 → C3 gets p2
  C2 revokes p5 → C3 gets p5

  Total consumption pause: ~500ms for only reassigned partitions (p2, p5)
```

From `ConsumerCoordinator.java:824`:

```java
switch (protocol) {
    case EAGER:
        // revoke all partitions
        revokedPartitions.addAll(subscriptions.assignedPartitions());
        exception = rebalanceListenerInvoker.invokePartitionsRevoked(revokedPartitions);
        subscriptions.assignFromSubscribed(Collections.emptySet());
        break;

    case COOPERATIVE:
        // only revoke those partitions that are not in the subscription anymore.
        Set<TopicPartition> ownedPartitions = new HashSet<>(subscriptions.assignedPartitions());
        revokedPartitions.addAll(ownedPartitions.stream()
            .filter(tp -> !subscriptions.subscription().contains(tp.topic()))
            .collect(Collectors.toSet()));

        if (!revokedPartitions.isEmpty()) {
            exception = rebalanceListenerInvoker.invokePartitionsRevoked(revokedPartitions);
            ownedPartitions.removeAll(revokedPartitions);
            subscriptions.assignFromSubscribed(ownedPartitions);
        }
        break;
}
```

**Trade-off:**
- **Eager**: Simple, all consumers sync at once (stopped-the-world)
- **Cooperative**: Complex (multi-round rebalancing), but minimal consumption disruption

## Offset Management

### Offset Commit Protocol

Offsets are stored in the **`__consumer_offsets`** topic, a compacted log where:
- **Key**: `(group.id, topic, partition)`
- **Value**: `(offset, metadata, commit_timestamp, expire_timestamp)`

```
__consumer_offsets-17:
  Key: ("my-app", "orders", 0) → Value: (offset=12345, commit_ts=1697890000)
  Key: ("my-app", "orders", 1) → Value: (offset=67890, commit_ts=1697890001)
  Key: ("my-app", "orders", 2) → Value: (offset=11111, commit_ts=1697890002)
```

From `OffsetMetadataManager.java:600`:

```java
public CoordinatorResult<OffsetCommitResponseData, CoordinatorRecord> commitOffset(
    AuthorizableRequestContext context,
    OffsetCommitRequestData request
) throws ApiException {
    Group group = validateOffsetCommit(context, request);

    // In the old consumer group protocol, the offset commits maintain the session if
    // the group is in Stable or PreparingRebalance state.
    if (group.type() == Group.GroupType.CLASSIC) {
        ClassicGroup classicGroup = (ClassicGroup) group;
        if (classicGroup.isInState(STABLE) || classicGroup.isInState(PREPARING_REBALANCE)) {
            groupMetadataManager.rescheduleClassicGroupMemberHeartbeat(
                classicGroup,
                classicGroup.member(request.memberId())
            );
        }
    }

    final OffsetCommitResponseData response = new OffsetCommitResponseData();
    final List<CoordinatorRecord> records = new ArrayList<>();
    final long currentTimeMs = time.milliseconds();
    final OptionalLong expireTimestampMs = expireTimestampMs(request.retentionTimeMs(), currentTimeMs);

    request.topics().forEach(topic -> {
        topic.partitions().forEach(partition -> {
            // Build offset commit record
            final OffsetAndMetadata offsetAndMetadata = OffsetAndMetadata.fromRequest(
                topic.topicId(),
                partition,
                currentTimeMs,
                expireTimestampMs
            );

            // Add record to be written to __consumer_offsets
            records.add(CoordinatorRecordHelpers.newOffsetCommitRecord(
                request.groupId(),
                topic.name(),
                partition.partitionIndex(),
                offsetAndMetadata,
                metadataImage.features().metadataVersion()
            ));
        });
    });

    return new CoordinatorResult<>(records, response);
}
```

### Commit Strategies

#### 1. Auto-Commit (Default)

```java
// Consumer config
props.put("enable.auto.commit", "true");
props.put("auto.commit.interval.ms", "5000");  // Commit every 5 seconds

// Consumer loop (simplified)
while (true) {
  ConsumerRecords<K, V> records = consumer.poll(Duration.ofMillis(100));

  for (ConsumerRecord<K, V> record : records) {
    processRecord(record);
  }

  // Auto-commit happens in background
  // - Triggered every auto.commit.interval.ms
  // - Commits offsets from last poll()
}
```

**Problem: At-least-once with potential duplicates**
```
1. poll() returns messages [100-199]
2. Process messages [100-149]
3. Consumer crashes
4. Auto-commit was scheduled but didn't run
5. Consumer restarts, offset still at 99
6. Re-processes messages [100-149] → DUPLICATES
```

#### 2. Manual Commit (Sync)

```java
props.put("enable.auto.commit", "false");

while (true) {
  ConsumerRecords<K, V> records = consumer.poll(Duration.ofMillis(100));

  for (ConsumerRecord<K, V> record : records) {
    processRecord(record);
  }

  // Synchronous commit after processing batch
  consumer.commitSync();  // Blocks until offsets written to __consumer_offsets
}
```

**Guarantee: At-least-once**
- If crash occurs after processing but before commit → duplicates on restart
- If crash occurs after commit → no duplicates

#### 3. Manual Commit (Async)

```java
while (true) {
  ConsumerRecords<K, V> records = consumer.poll(Duration.ofMillis(100));

  for (ConsumerRecord<K, V> record : records) {
    processRecord(record);
  }

  // Asynchronous commit (non-blocking)
  consumer.commitAsync((offsets, exception) -> {
    if (exception != null) {
      log.error("Offset commit failed", exception);
    }
  });
}
```

**Trade-off:** Lower latency but no guarantee that commit succeeded before crash.

#### 4. Exactly-Once with Transactions

```java
// Producer side (transactional writes)
producer.initTransactions();

producer.beginTransaction();
producer.send(new ProducerRecord<>("topic", key, value));
producer.commitTransaction();  // Atomically commits messages + offsets

// Consumer side (read committed only)
props.put("isolation.level", "read_committed");

while (true) {
  ConsumerRecords<K, V> records = consumer.poll(Duration.ofMillis(100));

  for (ConsumerRecord<K, V> record : records) {
    processRecord(record);

    // Send output transactionally
    producer.beginTransaction();
    producer.send(new ProducerRecord<>("output-topic", ...));
    producer.sendOffsetsToTransaction(
      Map.of(new TopicPartition(record.topic(), record.partition()),
             new OffsetAndMetadata(record.offset() + 1)),
      consumer.groupMetadata()
    );
    producer.commitTransaction();
  }
}
```

**Guarantee: Exactly-once end-to-end**
- Offset commit and output message write are **atomic**
- If transaction fails, neither offset nor output is committed
- Consumer skips aborted transactions (`isolation.level=read_committed`)

## Heartbeat and Session Management

### Heartbeat Thread

Consumers send periodic heartbeats to the coordinator to signal liveness.

From `AbstractCoordinator.java:1454`:

```java
private class HeartbeatThread extends BaseHeartbeatThread {
    @Override
    protected void onSend() {
        synchronized (AbstractCoordinator.this) {
            if (!isRunning() || state != MemberState.STABLE) {
                // The coordinator may have failed while sending heartbeat
                return;
            }

            if (coordinatorUnknown()) {
                // Try to find the coordinator
                lookupCoordinator();
            } else {
                // Send heartbeat
                long now = time.milliseconds();
                lastHeartbeatSend = now;

                HeartbeatRequest.Builder requestBuilder = new HeartbeatRequest.Builder(
                    new HeartbeatRequestData()
                        .setGroupId(rebalanceConfig.groupId)
                        .setMemberId(memberId)
                        .setGenerationId(generation.generationId)
                        .setGroupInstanceId(rebalanceConfig.groupInstanceId.orElse(null))
                );

                client.send(coordinator, requestBuilder)
                    .compose(new HeartbeatResponseHandler(generation));
            }
        }
    }
}
```

### Session Timeout Detection

The coordinator tracks the last heartbeat from each member:

From `GroupMetadataManager.java:7660`:

```java
public CoordinatorResult<HeartbeatResponseData, CoordinatorRecord> classicGroupHeartbeat(
    AuthorizableRequestContext context,
    HeartbeatRequestData request
) {
    Group group;
    try {
        group = group(request.groupId());
    } catch (GroupIdNotFoundException e) {
        throw new UnknownMemberIdException(
            String.format("Group %s not found.", request.groupId())
        );
    }

    if (group.type() == CLASSIC) {
        return classicGroupHeartbeatToClassicGroup((ClassicGroup) group, context, request);
    } else if (group.type() == CONSUMER) {
        return classicGroupHeartbeatToConsumerGroup((ConsumerGroup) group, context, request);
    } else {
        throw new UnknownMemberIdException(
            String.format("Group %s not found.", request.groupId())
        );
    }
}
```

**Failure Detection:**
```
1. Consumer C1 sends heartbeat at t=0
2. Coordinator sets timeout = t + session.timeout.ms (e.g., t + 10s)
3. C1 sends heartbeat at t=3 → timeout reset to t + 13s
4. C1 crashes at t=5
5. No heartbeat received by t=13s
6. Coordinator removes C1 from group
7. Triggers rebalance (generation N → N+1)
8. Remaining consumers rejoin and get new assignments
```

### Configuration Tuning

| Parameter               | Default | Purpose                                             | Recommendation                                     |
|-------------------------|---------|-----------------------------------------------------|----------------------------------------------------|
| `session.timeout.ms`    | 45000   | Max time between heartbeats before member evicted   | 10000-30000 (balance detection speed vs stability) |
| `heartbeat.interval.ms` | 3000    | Frequency of heartbeat requests                     | session.timeout.ms / 3                             |
| `max.poll.interval.ms`  | 300000  | Max time between poll() calls before rebalance      | Set based on max processing time per batch         |
| `rebalance.timeout.ms`  | 300000  | Max time for all members to rejoin during rebalance | Increase for large groups (1000+ consumers)        |

**Relationship:**
```
heartbeat.interval.ms < session.timeout.ms < max.poll.interval.ms

Example:
  heartbeat.interval.ms = 3000   (3 sec)
  session.timeout.ms = 10000     (10 sec)
  max.poll.interval.ms = 300000  (5 min)
```

**Why `max.poll.interval.ms` > `session.timeout.ms`?**
- Heartbeat thread runs independently of `poll()` thread
- Consumer can heartbeat while processing messages from last `poll()`
- If `poll()` not called within `max.poll.interval.ms` → consumer assumed stuck → triggers rebalance

## Summary

Kafka's consumer group protocol provides **distributed, fault-tolerant consumption** through:

1. **Group Coordinator**: Centralized component managing group membership and partition assignment
2. **Join-Sync Protocol**: Two-phase rebalancing ensures all consumers receive consistent assignments
3. **Generation IDs**: Epoch-based fencing prevents zombie consumers from committing stale offsets
4. **Heartbeat Mechanism**: Detects failed consumers and triggers automatic rebalancing
5. **Pluggable Assignment Strategies**: Range, RoundRobin, Sticky, and Cooperative for different trade-offs
6. **Offset Commit Protocol**: Durable offset storage in `__consumer_offsets` topic
7. **Static Membership**: Eliminates unnecessary rebalances during rolling restarts

The protocol achieves **at-least-once** delivery by default, with **exactly-once** semantics available through transactional APIs.

In the next post, we'll take a practical approach to **consumer groups** an what we learned so far in this Kafka internal series.

---

*This series explores Apache Kafka's internal architecture at the code level. All references are to the Apache Kafka 4.1.0+ codebase.*