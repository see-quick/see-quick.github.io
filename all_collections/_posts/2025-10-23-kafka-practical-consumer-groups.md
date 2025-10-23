---
layout: post
title: "24 🔧 Kafka Practical: Consumer Groups"
date: 2025-10-23
categories: ["apache-kafka", "distributed-systems", "consumer-groups"]
---

In the [previous post](/posts/kafka-internals-consumer-groups-coordination), we explored the theoretical foundations of Kafka's consumer group protocol—the join-sync dance, partition assignment strategies, and offset management internals. 
Now, let's get practical.

This post focuses on **hands-on examples** using Kafka 4.x.x, showing you how to work with consumer groups.

## Setup: Quick Start

First, let's set up a simple Kafka cluster and topic:

```bash
# Start Kafka in KRaft mode
kafka-storage format -t $(kafka-storage random-uuid) -c config/kraft/server.properties
kafka-server-start config/kraft/server.properties

# Create a topic with 6 partitions
kafka-topics --bootstrap-server localhost:9092 \
  --create --topic demo-orders \
  --partitions 6 \
  --replication-factor 1

# Produce some test data
kafka-producer-perf-test \
  --topic demo-orders \
  --num-records 1000 \
  --record-size 100 \
  --throughput 100 \
  --producer-props bootstrap.servers=localhost:9092
```

**Note:** Between scenarios, remember to terminate all running consumers (Ctrl+C) to avoid interference with the next test.

## Scenario 1: Observing Partition Assignment

Let's start three consumers in the same group and watch how partitions get assigned.

**Consumer 1:**
```bash
kafka-console-consumer \
  --bootstrap-server localhost:9092 \
  --topic demo-orders \
  --group demo-group \
  --property print.partition=true \
  --property print.offset=true
```

**While it's running, in a new terminal, check the group:**
```bash
kafka-consumer-groups --bootstrap-server localhost:9092 \
  --group demo-group --describe

# if you are too quick you might get => `Warning: Consumer group 'demo-group' is rebalancing.`

# Output:
GROUP           TOPIC           PARTITION  CURRENT-OFFSET  LOG-END-OFFSET  LAG             CONSUMER-ID                                           HOST            CLIENT-ID
demo-group      demo-orders     4          -               103             -               console-consumer-801d7cec-3bb7-4d98-a20e-bfc325394f6d /127.0.0.1      console-consumer
demo-group      demo-orders     3          -               103             -               console-consumer-801d7cec-3bb7-4d98-a20e-bfc325394f6d /127.0.0.1      console-consumer
demo-group      demo-orders     2          -               214             -               console-consumer-801d7cec-3bb7-4d98-a20e-bfc325394f6d /127.0.0.1      console-consumer
demo-group      demo-orders     1          -               417             -               console-consumer-801d7cec-3bb7-4d98-a20e-bfc325394f6d /127.0.0.1      console-consumer
demo-group      demo-orders     5          -               163             -               console-consumer-801d7cec-3bb7-4d98-a20e-bfc325394f6d /127.0.0.1      console-consumer
demo-group      demo-orders     0          -               0               -               console-consumer-801d7cec-3bb7-4d98-a20e-bfc325394f6d /127.0.0.1      console-consumer
```

**Observation:** Single consumer gets **all 6 partitions**.

**Now start Consumer 2 (same group):**
```bash
kafka-console-consumer \
  --bootstrap-server localhost:9092 \
  --topic demo-orders \
  --group demo-group \
  --property print.partition=true
```

**Check group state again:**
```bash
kafka-consumer-groups --bootstrap-server localhost:9092 \
  --group demo-group --describe

GROUP           TOPIC           PARTITION  CURRENT-OFFSET  LOG-END-OFFSET  LAG             CONSUMER-ID                                           HOST            CLIENT-ID
demo-group      demo-orders     4          103             103             0               console-consumer-e4575ac0-4975-425b-bc18-3d0939479e3d /127.0.0.1      console-consumer
demo-group      demo-orders     3          103             103             0               console-consumer-e4575ac0-4975-425b-bc18-3d0939479e3d /127.0.0.1      console-consumer
demo-group      demo-orders     5          163             163             0               console-consumer-e4575ac0-4975-425b-bc18-3d0939479e3d /127.0.0.1      console-consumer
demo-group      demo-orders     2          214             214             0               console-consumer-801d7cec-3bb7-4d98-a20e-bfc325394f6d /127.0.0.1      console-consumer
demo-group      demo-orders     1          417             417             0               console-consumer-801d7cec-3bb7-4d98-a20e-bfc325394f6d /127.0.0.1      console-consumer
demo-group      demo-orders     0          0               0               0               console-consumer-801d7cec-3bb7-4d98-a20e-bfc325394f6d /127.0.0.1      console-consumer
```

and we can see that the rebalance happen and partitions are now split into two consumers (i.e., Consumer 1: `[4, 3, 5]` and Consumer 2: `[2, 1, 0]`).
Also in Broker's log, one can see `GroupCoordinator`:
```java
[2025-10-23 15:58:44,544] INFO [GroupCoordinator id=1 topic=__consumer_offsets partition=15] Dynamic member with unknown member id joins group demo-group in Empty state. Created a new member id console-consumer-801d7cec-3bb7-4d98-a20e-bfc325394f6d and requesting the member to rejoin with this id. (org.apache.kafka.coordinator.group.GroupMetadataManager)
[2025-10-23 15:58:44,547] INFO [GroupCoordinator id=1 topic=__consumer_offsets partition=15] Pending dynamic member with id console-consumer-801d7cec-3bb7-4d98-a20e-bfc325394f6d joins group demo-group in Empty state. Adding to the group now. (org.apache.kafka.coordinator.group.GroupMetadataManager)
[2025-10-23 15:58:44,551] INFO [GroupCoordinator id=1 topic=__consumer_offsets partition=15] Preparing to rebalance group demo-group in state PreparingRebalance with old generation 0 (reason: Adding new member console-consumer-801d7cec-3bb7-4d98-a20e-bfc325394f6d with group instance id null; client reason: need to re-join with the given member-id: console-consumer-801d7cec-3bb7-4d98-a20e-bfc325394f6d). (org.apache.kafka.coordinator.group.GroupMetadataManager)
[2025-10-23 15:58:47,561] INFO [GroupCoordinator id=1 topic=__consumer_offsets partition=15] Stabilized group demo-group generation 1 with 1 members. (org.apache.kafka.coordinator.group.GroupMetadataManager)
[2025-10-23 15:58:47,579] INFO [GroupCoordinator id=1 topic=__consumer_offsets partition=15] Assignment received from leader console-consumer-801d7cec-3bb7-4d98-a20e-bfc325394f6d for group demo-group for generation 1. The group has 1 members, 0 of which are static. (org.apache.kafka.coordinator.group.GroupMetadataManager)
[2025-10-23 16:00:27,860] INFO [GroupCoordinator id=1 topic=__consumer_offsets partition=15] Dynamic member with unknown member id joins group demo-group in Stable state. Created a new member id console-consumer-e4575ac0-4975-425b-bc18-3d0939479e3d and requesting the member to rejoin with this id. (org.apache.kafka.coordinator.group.GroupMetadataManager)
[2025-10-23 16:00:27,863] INFO [GroupCoordinator id=1 topic=__consumer_offsets partition=15] Pending dynamic member with id console-consumer-e4575ac0-4975-425b-bc18-3d0939479e3d joins group demo-group in Stable state. Adding to the group now. (org.apache.kafka.coordinator.group.GroupMetadataManager)
[2025-10-23 16:00:27,863] INFO [GroupCoordinator id=1 topic=__consumer_offsets partition=15] Preparing to rebalance group demo-group in state PreparingRebalance with old generation 1 (reason: Adding new member console-consumer-e4575ac0-4975-425b-bc18-3d0939479e3d with group instance id null; client reason: need to re-join with the given member-id: console-consumer-e4575ac0-4975-425b-bc18-3d0939479e3d). (org.apache.kafka.coordinator.group.GroupMetadataManager)
[2025-10-23 16:00:29,630] INFO [GroupCoordinator id=1 topic=__consumer_offsets partition=15] Stabilized group demo-group generation 2 with 2 members. (org.apache.kafka.coordinator.group.GroupMetadataManager)
[2025-10-23 16:00:29,642] INFO [GroupCoordinator id=1 topic=__consumer_offsets partition=15] Assignment received from leader console-consumer-801d7cec-3bb7-4d98-a20e-bfc325394f6d for group demo-group for generation 2. The group has 2 members, 0 of which are static. (org.apache.kafka.coordinator.group.GroupMetadataManager)
```
These logs trace the complete join-sync protocol discussed in the [previous post](/posts/kafka-internals-consumer-groups-coordination)—first consumer triggers generation 0→1 transition, then second consumer joining causes generation 1→2, rebalancing the 6 partitions evenly across both members:

```
Generation 0 (Empty)
    ↓
Generation 1 (1 member)      Consumer-1: [0,1,2,3,4,5]
    ↓ (new member joins)
Generation 2 (2 members)     Consumer-1: [2,1,0]
                             Consumer-2: [4,3,5]
```

**Start Consumer 3:**
```bash
# Rebalance again:
GROUP           TOPIC           PARTITION  CURRENT-OFFSET  LOG-END-OFFSET  LAG             CONSUMER-ID                                           HOST            CLIENT-ID
demo-group      demo-orders     4          103             103             0               console-consumer-e4575ac0-4975-425b-bc18-3d0939479e3d /127.0.0.1      console-consumer
demo-group      demo-orders     5          163             163             0               console-consumer-e4575ac0-4975-425b-bc18-3d0939479e3d /127.0.0.1      console-consumer
demo-group      demo-orders     3          103             103             0               console-consumer-801d7cec-3bb7-4d98-a20e-bfc325394f6d /127.0.0.1      console-consumer
demo-group      demo-orders     2          214             214             0               console-consumer-801d7cec-3bb7-4d98-a20e-bfc325394f6d /127.0.0.1      console-consumer
demo-group      demo-orders     1          417             417             0               console-consumer-374a4f33-3efd-41a8-9d1b-1c0348fda157 /127.0.0.1      console-consumer
demo-group      demo-orders     0          0               0               0               console-consumer-374a4f33-3efd-41a8-9d1b-1c0348fda157 /127.0.0.1      console-consumer
```

and the related log from Broker:
```java
[2025-10-23 16:12:27,412] INFO [GroupCoordinator id=1 topic=__consumer_offsets partition=15] Dynamic member with unknown member id joins group demo-group in Stable state. Created a new member id console-consumer-374a4f33-3efd-41a8-9d1b-1c0348fda157 and requesting the member to rejoin with this id. (org.apache.kafka.coordinator.group.GroupMetadataManager)
[2025-10-23 16:12:27,416] INFO [GroupCoordinator id=1 topic=__consumer_offsets partition=15] Pending dynamic member with id console-consumer-374a4f33-3efd-41a8-9d1b-1c0348fda157 joins group demo-group in Stable state. Adding to the group now. (org.apache.kafka.coordinator.group.GroupMetadataManager)
[2025-10-23 16:12:27,416] INFO [GroupCoordinator id=1 topic=__consumer_offsets partition=15] Preparing to rebalance group demo-group in state PreparingRebalance with old generation 2 (reason: Adding new member console-consumer-374a4f33-3efd-41a8-9d1b-1c0348fda157 with group instance id null; client reason: need to re-join with the given member-id: console-consumer-374a4f33-3efd-41a8-9d1b-1c0348fda157). (org.apache.kafka.coordinator.group.GroupMetadataManager)
[2025-10-23 16:12:29,935] INFO [GroupCoordinator id=1 topic=__consumer_offsets partition=15] Stabilized group demo-group generation 3 with 3 members. (org.apache.kafka.coordinator.group.GroupMetadataManager)
[2025-10-23 16:12:29,936] INFO [GroupCoordinator id=1 topic=__consumer_offsets partition=15] Assignment received from leader console-consumer-801d7cec-3bb7-4d98-a20e-bfc325394f6d for group demo-group for generation 3. The group has 3 members, 0 of which are static. (org.apache.kafka.coordinator.group.GroupMetadataManager)
```

**Cleanup:** Before moving to the next scenario, terminate all three consumers (Ctrl+C).

## Scenario 2: Comparing Assignment Strategies

Let's see how different strategies behave when consuming multiple topics.

**Setup two topics:**
```bash
kafka-topics --bootstrap-server localhost:9092 \
  --create --topic topic-a --partitions 5 --replication-factor 1

kafka-topics --bootstrap-server localhost:9092 \
  --create --topic topic-b --partitions 5 --replication-factor 1
```

### Using Range Assignor (Default)

```bash
# Start 3 consumers with RangeAssignor (using topic pattern to match both topics)
kafka-console-consumer \
  --bootstrap-server localhost:9092 \
  --include "topic-.*" \
  --group range-group \
  --consumer-property partition.assignment.strategy=org.apache.kafka.clients.consumer.RangeAssignor
```

**Result (imbalanced):**
```bash
kafka-consumer-groups --bootstrap-server localhost:9092 \
  --group range-group --describe

GROUP           TOPIC           PARTITION ...  CONSUMER-ID                                            ...
range-group     topic-a         1         ...  console-consumer-56183251-3191-45be-b284-d3d9ab47b24b  ...
range-group     topic-a         0         ...  console-consumer-56183251-3191-45be-b284-d3d9ab47b24b  ...
range-group     topic-b         1         ...  console-consumer-56183251-3191-45be-b284-d3d9ab47b24b  ...
range-group     topic-b         0         ...  console-consumer-56183251-3191-45be-b284-d3d9ab47b24b  ...
range-group     topic-a         3         ...  console-consumer-5c3145bc-703a-4c5b-a18e-ac44235d821b  ...
range-group     topic-a         2         ...  console-consumer-5c3145bc-703a-4c5b-a18e-ac44235d821b  ...
range-group     topic-b         3         ...  console-consumer-5c3145bc-703a-4c5b-a18e-ac44235d821b  ...
range-group     topic-b         2         ...  console-consumer-5c3145bc-703a-4c5b-a18e-ac44235d821b  ...
range-group     topic-a         4         ...  console-consumer-dc252d48-92bb-4e73-b651-a484464ddee8  ...
range-group     topic-b         4         ...  console-consumer-dc252d48-92bb-4e73-b651-a484464ddee8  ...

# Consumer-1 (56183251...): topic-a[0,1], topic-b[0,1]  = 4 partitions
# Consumer-2 (5c3145bc...): topic-a[2,3], topic-b[2,3]  = 4 partitions
# Consumer-3 (dc252d48...): topic-a[4],   topic-b[4]    = 2 partitions  ← Less work! => i.e., imbalanced
```

### Using RoundRobin Assignor

```bash
kafka-console-consumer \
  --bootstrap-server localhost:9092 \
  --include "topic-.*" \
  --group roundrobin-group \
  --consumer-property partition.assignment.strategy=org.apache.kafka.clients.consumer.RoundRobinAssignor
```

**Result (balanced):**
```bash
GROUP            TOPIC           PARTITION                  CONSUMER-ID                                         
roundrobin-group topic-a         3         ...   console-consumer-2e0deed7-c711-483f-8b41-cd6a920d8d82 ...
roundrobin-group topic-b         4         ...   console-consumer-2e0deed7-c711-483f-8b41-cd6a920d8d82 ...
roundrobin-group topic-a         0         ...   console-consumer-2e0deed7-c711-483f-8b41-cd6a920d8d82 ...
roundrobin-group topic-b         1         ...   console-consumer-2e0deed7-c711-483f-8b41-cd6a920d8d82 ...
roundrobin-group topic-a         2         ...   console-consumer-8a987ff1-56c4-4a11-984e-0cce99d59a81 ...
roundrobin-group topic-b         3         ...   console-consumer-8a987ff1-56c4-4a11-984e-0cce99d59a81 ...
roundrobin-group topic-b         0         ...   console-consumer-8a987ff1-56c4-4a11-984e-0cce99d59a81 ...
roundrobin-group topic-a         4         ...   console-consumer-7a09ed5a-0e82-42b9-9243-b578d9ec1a9f ...
roundrobin-group topic-a         1         ...   console-consumer-7a09ed5a-0e82-42b9-9243-b578d9ec1a9f ...
roundrobin-group topic-b         2         ...   console-consumer-7a09ed5a-0e82-42b9-9243-b578d9ec1a9f ...

# Consumer-1 (cd6a920d...): topic-a[0,3], topic-b[1,4]  = 4 partitions
# Consumer-2 (0cce99d5...): topic-a[2], topic-b[0,3]  = 3 partitions
# Consumer-3 (b578d9ec...): topic-a[1,4],   topic-b[2]    = 3 partitions
```

Key observation here is that, RoundRobin improves balance (4-3-3 vs 4-4-2 with Range) but **isn't** perfect since 10 total partitions don't divide evenly by 3 consumers.
The **key difference** is that RangeAssignor works per-topic independently (causing compound imbalance), while RoundRobinAssignor distributes across all topic-partitions globally.
So to sum up: for multi-topic consumption, prefer RoundRobinAssignor or StickyAssignor to minimize imbalance.

## Scenario 3: Testing Sticky Assignment

Sticky assignment minimizes partition movement during rebalancing. 
So let's test this in practice...

**Start 3 consumers with StickyAssignor:**
```bash
kafka-console-consumer \
  --bootstrap-server localhost:9092 \
  --topic demo-orders \
  --group sticky-group \
  --consumer-property partition.assignment.strategy=org.apache.kafka.clients.consumer.StickyAssignor
```

**Initial assignment:**
```bash
GROUP           TOPIC           PARTITION ...  CONSUMER-ID                                             ...
sticky-group    demo-orders     4         ...  console-consumer-53558f73-4f1d-4f0d-ae89-ca3c331e8998   ...
sticky-group    demo-orders     1         ...  console-consumer-53558f73-4f1d-4f0d-ae89-ca3c331e8998   ...
sticky-group    demo-orders     2         ...  console-consumer-decd4a0a-cb22-46fa-8d4b-169b482417d2   ...
sticky-group    demo-orders     5         ...  console-consumer-decd4a0a-cb22-46fa-8d4b-169b482417d2   ...
sticky-group    demo-orders     3         ...  console-consumer-4561230a-a877-4a13-922f-257845ae9063   ...
sticky-group    demo-orders     0         ...  console-consumer-4561230a-a877-4a13-922f-257845ae9063   ...

# Consumer-1 (ca3c331e8998...): demo-orders[1,4]  = 2 partitions
# Consumer-2 (169b482417d2...): demo-orders[2,5]  = 2 partitions
# Consumer-3 (257845ae9063...): demo-orders[0,3]   = 2 partitions
```

**Kill Consumer-3 (Ctrl+C)** and observe:

**With RoundRobin** (baseline comparison):
```bash
All partitions redistributed from scratch:
Consumer-1: [0, 2, 4]  ← lost [1], gained [0, 2]
Consumer-2: [1, 3, 5]  ← lost [2], gained [1, 3]
# Total movement: 4 partitions reassigned (instead of 2 when we compare StickyAssignor)
```

**With StickyAssignor:**
```bash
GROUP           TOPIC           PARTITION  ...  CONSUMER-ID                                           ...
sticky-group    demo-orders     4          ...  console-consumer-53558f73-4f1d-4f0d-ae89-ca3c331e8998 ...
sticky-group    demo-orders     1          ...  console-consumer-53558f73-4f1d-4f0d-ae89-ca3c331e8998 ...
sticky-group    demo-orders     0          ...  console-consumer-53558f73-4f1d-4f0d-ae89-ca3c331e8998 ...
sticky-group    demo-orders     3          ...  console-consumer-decd4a0a-cb22-46fa-8d4b-169b482417d2 ...
sticky-group    demo-orders     2          ...  console-consumer-decd4a0a-cb22-46fa-8d4b-169b482417d2 ...
sticky-group    demo-orders     5          ...  console-consumer-decd4a0a-cb22-46fa-8d4b-169b482417d2 ...

# Minimal redistribution:
# Consumer-1: [1, 4, 0]  ← kept [1,4], got only [0]
# Consumer-2: [2, 5, 3]  ← kept [2,5], got only [3]
```

So to conclude, the clear benefit of using `StickyAssignor` is to have less state rebuilding (caches, aggregations) in consumers.
Moreover, in environments with frequent consumer join/leaves (autoscaling, rolling deployments), sticky assignment reduces movement.
Plus for multi-topic consumption it's better balance than Range Assignor (default) with the added benefit of stability. 
On the other hand, we have also cases where to **NOT** use it:
1. If consumers are stateless (i.e., no caches).
2. For singe-topic the default assignor is simpler and sufficient.
3. If you don't care about partition movement

## Scenario 4: Cooperative Rebalancing

Cooperative (incremental) rebalancing eliminates the **stop-the-world** problem (i.e., even if rebalanced is triggered then you would be able to consume from certain partitions). 
So let's see how it goes...

**Java Consumer with Cooperative Rebalancing:**
```java
//  ... (other stuff prohibited for brevity) 
Properties props = new Properties();
props.put(ConsumerConfig.BOOTSTRAP_SERVERS_CONFIG, "localhost:9092");
props.put(ConsumerConfig.GROUP_ID_CONFIG, "coop-group");
props.put(ConsumerConfig.KEY_DESERIALIZER_CLASS_CONFIG, StringDeserializer.class);
props.put(ConsumerConfig.VALUE_DESERIALIZER_CLASS_CONFIG, StringDeserializer.class);

// Enable Cooperative Sticky Assignor
props.put(ConsumerConfig.PARTITION_ASSIGNMENT_STRATEGY_CONFIG,
          "org.apache.kafka.clients.consumer.CooperativeStickyAssignor");

KafkaConsumer<String, String> consumer = new KafkaConsumer<>(props);
consumer.subscribe(Collections.singletonList("demo-orders"));

while (true) {
    ConsumerRecords<String, String> records = consumer.poll(Duration.ofMillis(100));

    for (ConsumerRecord<String, String> record : records) {
        System.out.printf("Partition %d, Offset %d: %s%n",
                         record.partition(), record.offset(), record.value());
    }
}
// ...
```

**What happens during rebalancing:**

**Eager (traditional):**
```
1. Rebalance triggered
2. ALL consumers stop consuming (revoke all partitions)
3. Wait for reassignment
4. Resume consuming
   Total pause: it should be ~2-5 seconds for entire group
```

**Cooperative:**
```
1. Rebalance triggered
2. Only affected partitions paused
3. Other partitions continue consuming
4. Incremental reassignment
   Total pause: approx ~500ms for only reassigned partitions
```

**Monitoring the difference:**
```bash
# With Eager: all consumer threads pause
# Lag spikes on ALL partitions

# With Cooperative: selective pause
# Lag spikes only on reassigned partitions (2 out of 6)
```

## Scenario 5: Static Membership (Rolling Restarts)

Static membership prevents unnecessary rebalances during rolling restarts.

**Without Static Membership:**
```bash
# Deploy new version: restart Consumer-1
# → Rebalance (generation N → N+1)
# Wait 30 sec, restart Consumer-2
# → Rebalance (generation N+1 → N+2)
# Wait 30 sec, restart Consumer-3
# → Rebalance (generation N+2 → N+3)
# Total: 3 rebalances!
```

**With Static Membership:**
```java
Properties props = new Properties();
props.put(ConsumerConfig.GROUP_ID_CONFIG, "static-group");

// Set static member ID (unique per instance, stable across restarts)
props.put(ConsumerConfig.GROUP_INSTANCE_ID_CONFIG, "consumer-host-1");

// Increase session timeout for longer restart window
props.put(ConsumerConfig.SESSION_TIMEOUT_MS_CONFIG, "300000"); // 5 min

KafkaConsumer<String, String> consumer = new KafkaConsumer<>(props);
```

**Behavior during rolling restart:**
```bash
# Stop Consumer-1 (instance-id=consumer-host-1)
# Coordinator waits session.timeout.ms (5 min)
# Start new Consumer-1 with same instance-id
# → Rejoins with same member ID
# → NO REBALANCE (partition assignment preserved!)

# Repeat for Consumer-2, Consumer-3
# Total: 0 rebalances
```

## Monitoring Consumer Groups

### Key Metrics to Track

```bash
# 1. Consumer Lag (critical metric)
kafka-consumer-groups --bootstrap-server localhost:9092 \
  --group demo-group --describe

# Watch for:
# - LAG > 1000 (sustained) → under-provisioned or slow processing
# - LAG growing → consumer can't keep up with producer
```

**Programmatic monitoring with JMX:**
```bash
# Enable JMX in consumer
export KAFKA_JMX_OPTS="-Dcom.sun.management.jmxremote \
  -Dcom.sun.management.jmxremote.port=9999 \
  -Dcom.sun.management.jmxremote.authenticate=false"

# Key metrics:
# - kafka.consumer:type=consumer-fetch-manager-metrics,client-id=<id>,topic=<topic>,partition=<partition>,name=records-lag
# - kafka.consumer:type=consumer-coordinator-metrics,client-id=<id>,name=commit-latency-avg
# - kafka.consumer:type=consumer-coordinator-metrics,client-id=<id>,name=join-rate
```

### Common Issues

**Issue 1: Frequent Rebalancing**

**Symptoms:**
```bash
# log is a bit simplified...
...
[2025-10-23] Group coordinator ... is rebalancing (reason: member consumer-1-abc left)
[2025-10-23] (Re-)joining group
...
# Repeating every few seconds
```

**Diagnosis:**
```bash
kafka-consumer-groups --bootstrap-server localhost:9092 \
  --group problem-group --describe --state

# Check: STATE column shows "PreparingRebalance" frequently
```

The root cause might be the value of `max.poll.interval.ms` is too low. 
One might increase poll interval for slow processing.
Also, another approach would be to reduce batch size to poll more frequently. 

```java
props.put(ConsumerConfig.MAX_POLL_INTERVAL_MS_CONFIG, "<value>");
// or 
props.put(ConsumerConfig.MAX_POLL_RECORDS_CONFIG, "<value>");
```

**Issue 2: Growing Consumer Lag**

**Diagnosis:**
```bash
watch -n 2 'kafka-consumer-groups --bootstrap-server localhost:9092 \
  --group my-group --describe'

# LAG column increasing: 100 → 500 → 1200 → 3000...
```

The solutions to such problem could be:
1. **Scale horizontally** i.e., adding more consumers 
- but note that you can't add more consumers than you have partitions
- for instance, if you have 6 partitions per topic you can have at most 6 consumers (**this is not true when you are using shared-groups,** but we are talking about classic groups)
2. **Increase partitions** 
- if we already have 1:1 ratio of consumers and partitions then viable option is to increase partitions => then we can increase number of consumers
3. **Optimize processing**
- lastly optimize processing by adding async I/O calls f.e.

```java
// Use async I/O for downstream calls
CompletableFuture.supplyAsync(() -> httpClient.send(...))
                 .thenAccept(response -> process(response));

// Batch database writes
List<Record> batch = new ArrayList<>();
for (ConsumerRecord<K, V> record : records) {
    batch.add(convert(record));
    if (batch.size() >= 100) {
        db.batchInsert(batch);
        batch.clear();
    }
}
```

## Practical Tips

### 1. Right-size Consumer Group

```
# Rule of thumb: # of consumers ≤ # of partitions
# Optimal: consumers = partitions (full parallelism)
# Over-provisioned: extra consumers sit idle
```

### 2. Monitor Rebalance Frequency

```
# Low frequency: normal
# Rebalance every few minutes: investigate max.poll.interval.ms
# Rebalance every few seconds: critical issue (heartbeat timeout)
```

### 3. Use Appropriate Assignment Strategy

```
Single topic:               RangeAssignor (default, fine)
Multiple topics:            RoundRobinAssignor or StickyAssignor
State-heavy consumers:      StickyAssignor
Low-latency requirement:    CooperativeStickyAssignor
Rolling deployments:        Static membership + StickyAssignor
```

### 4. Reset Offsets When Needed

```bash
# Reset to earliest (reprocess all data)
kafka-consumer-groups --bootstrap-server localhost:9092 \
  --group my-group --topic demo-orders \
  --reset-offsets --to-earliest --execute

# Reset to specific timestamp (e.g., replay last 1 hour)
kafka-consumer-groups --bootstrap-server localhost:9092 \
  --group my-group --topic demo-orders \
  --reset-offsets --to-datetime 2025-10-23T13:00:00.000 --execute

# Reset to specific offset
kafka-consumer-groups --bootstrap-server localhost:9092 \
  --group my-group --topic demo-orders:0 \
  --reset-offsets --to-offset 5000 --execute
```

## Summary

Consumer groups are Kafka's mechanism for scalable, fault-tolerant consumption. 
In practice:
1. **Monitor lag constantly** - it's your most important metric
2. **Choose the right assignment strategy** for your use case
3. **Use static membership** for rolling restarts
4. **Size your consumer group** correctly (i.e., consumers ≤ partitions)
5. **Tune timeouts** based on processing characteristics
6. **Test rebalancing behavior** before production

The [previous theoretical post](/posts/kafka-internals-consumer-groups-coordination) explained *how* the protocol works internally. 
This post showed you *how to use it* effectively.

**Next steps:** Try these examples with your own Kafka cluster. 
Experiment with different configurations and observe the behavior. 
The best way to understand consumer groups is to see them in action.

---

*Examples tested with Apache Kafka 4.2.x.*