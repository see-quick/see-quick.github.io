---
layout: post
title: "22 🧪 Kafka Practical: Performance Testing & Runtime Verification Through Logs"
date: 2025-10-16
categories: ["apache-kafka", "distributed-systems", "testing", "performance", "runtime-verification"]
---

After exploring Kafka's internals in our [previous posts](/posts/kafka-internals-replication-protocol), let's get hands-on.
I know, I mentioned that this blog post would cover consumer groups and coordination, but I would like to make a more practical one first to consolidate what we’ve learned before diving into that topic.
In this post, we'll conduct practical performance tests on a local Kafka cluster and verify its behavior through runtime log analysis.

## What We'll Build

A complete testing environment to:
1. Set up a 3-broker Kafka cluster with KRaft
2. Run a few performance tests (produce/consume workloads)
3. Monitor replication protocol behavior through logs
4. Verify consistency guarantees via runtime verification
5. Stress test failure scenarios

This combines **empirical testing** with **runtime verification** (i.e., validating that Kafka's actual behavior matches its theoretical guarantees).

## Prerequisites

```bash
# Install Kafka (macOS example)
brew install kafka
 
# Or download from Apache
wget https://dlcdn.apache.org/kafka/4.1.0/kafka_2.13-4.1.0.tgz
tar -xzf kafka_2.13-4.1.0.tgz
cd kafka_2.13-4.1.0
```


## Setting Up a 3-Broker KRaft Cluster

### Step 1: Generate Cluster ID

```bash
# Mac
# because now, every script would be in your PATH env, you can easily use it via terminal;
# now I would use this variant through whole blog so either you do it this way or just via bin/*.sh scripts 

KAFKA_CLUSTER_ID="$(kafka-storage random-uuid)"
echo "Cluster ID: $KAFKA_CLUSTER_ID"

# Linux 
KAFKA_CLUSTER_ID="$(bin/kafka-storage random-uuid)"
echo "Cluster ID: $KAFKA_CLUSTER_ID"
```

### Step 2: Create Server Configurations

Create three server properties files:

**config/kraft/server-1.properties:**
```bash
# Node ID
node.id=1
process.roles=broker,controller
controller.quorum.voters=1@localhost:9093,2@localhost:9094,3@localhost:9095

# Listeners
listeners=PLAINTEXT://localhost:9092,CONTROLLER://localhost:9093
advertised.listeners=PLAINTEXT://localhost:9092
controller.listener.names=CONTROLLER
listener.security.protocol.map=CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT

# Log directories
log.dirs=/tmp/kafka-logs-1

# Replication settings
default.replication.factor=3
min.insync.replicas=2
replica.lag.time.max.ms=10000

# Performance settings
num.network.threads=8
num.io.threads=16
socket.send.buffer.bytes=102400
socket.receive.buffer.bytes=102400
socket.request.max.bytes=104857600

# Log retention
log.retention.hours=1
log.segment.bytes=1073741824
log.cleanup.policy=delete
```

**config/kraft/server-2.properties:**
```bash
node.id=2
process.roles=broker,controller
controller.quorum.voters=1@localhost:9093,2@localhost:9094,3@localhost:9095

listeners=PLAINTEXT://localhost:19092,CONTROLLER://localhost:9094
advertised.listeners=PLAINTEXT://localhost:19092
controller.listener.names=CONTROLLER
listener.security.protocol.map=CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT

log.dirs=/tmp/kafka-logs-2

# Replication settings
default.replication.factor=3
min.insync.replicas=2
replica.lag.time.max.ms=10000

# Performance settings
num.network.threads=8
num.io.threads=16
socket.send.buffer.bytes=102400
socket.receive.buffer.bytes=102400
socket.request.max.bytes=104857600

# Log retention
log.retention.hours=1
log.segment.bytes=1073741824
log.cleanup.policy=delete
```

**config/kraft/server-3.properties:**
```bash
node.id=3
process.roles=broker,controller
controller.quorum.voters=1@localhost:9093,2@localhost:9094,3@localhost:9095

listeners=PLAINTEXT://localhost:29092,CONTROLLER://localhost:9095
advertised.listeners=PLAINTEXT://localhost:29092
controller.listener.names=CONTROLLER
listener.security.protocol.map=CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT

log.dirs=/tmp/kafka-logs-3

# Replication settings
default.replication.factor=3
min.insync.replicas=2
replica.lag.time.max.ms=10000

# Performance settings
num.network.threads=8
num.io.threads=16
socket.send.buffer.bytes=102400
socket.receive.buffer.bytes=102400
socket.request.max.bytes=104857600

# Log retention
log.retention.hours=1
log.segment.bytes=1073741824
log.cleanup.policy=delete
```

### Step 3: Format Storage Directories

```bash
kafka-storage format -t $KAFKA_CLUSTER_ID -c config/kraft/server-1.properties
kafka-storage format -t $KAFKA_CLUSTER_ID -c config/kraft/server-2.properties
kafka-storage format -t $KAFKA_CLUSTER_ID -c config/kraft/server-3.properties
```

### Step 4: Start Brokers

```bash
# Terminal 1 - Broker 1
kafka-server-start config/kraft/server-1.properties

# Terminal 2 - Broker 2
kafka-server-start config/kraft/server-2.properties

# Terminal 3 - Broker 3
kafka-server-start config/kraft/server-3.properties
```

### Step 5: Verify Cluster Health

```bash
# List brokers
kafka-broker-api-versions --bootstrap-server localhost:9092 | grep id

# one should see: 
#    localhost:9092 (id: 1 rack: null isFenced: false) -> (
#    localhost:19092 (id: 2 rack: null isFenced: false) -> (
#    localhost:29092 (id: 3 rack: null isFenced: false) -> (

# Create test topic
kafka-topics --create \
  --topic performance-test \
  --bootstrap-server localhost:9092 \
  --partitions 3 \
  --replication-factor 3 \
  --config min.insync.replicas=2
# Created topic performance-test.

# Describe topic
kafka-topics --describe \
  --topic performance-test \
  --bootstrap-server localhost:9092
```

Expected output:
```
Topic: performance-test TopicId: AMNt6PcpRZOktSh6v-u00A PartitionCount: 3       ReplicationFactor: 3    Configs: min.insync.replicas=2,cleanup.policy=delete,segment.bytes=1073741824
        Topic: performance-test Partition: 0    Leader: 2       Replicas: 2,3,1 Isr: 2,3,1      Elr:    LastKnownElr:
        Topic: performance-test Partition: 1    Leader: 3       Replicas: 3,1,2 Isr: 3,1,2      Elr:    LastKnownElr:
        Topic: performance-test Partition: 2    Leader: 1       Replicas: 1,2,3 Isr: 1,2,3      Elr:    LastKnownElr:
```

## Performance Testing

Now that our cluster is running, let's measure its performance characteristics with different configurations. All benchmarks were conducted on a **MacBook Pro M3 (16GB RAM)** running Kafka 4.1.0.

### Baseline Throughput Test

This test establishes baseline performance with production-ready settings: strong durability guarantees (`acks=all`), efficient compression (LZ4), and optimized batching.

**Test Command:**
```bash
kafka-producer-perf-test \
  --topic performance-test \
  --num-records 1000000 \
  --record-size 1024 \
  --throughput -1 \
  --producer-props \
    bootstrap.servers=localhost:9092 \
    acks=all \
    linger.ms=10 \
    batch.size=32768 \
    compression.type=lz4
```

**Results:**
```
355262 records sent, 71052.4 records/sec (69.39 MB/sec), 379.9 ms avg latency, 791.0 ms max latency.
1000000 records sent, 119660.2 records/sec (116.86 MB/sec), 213.55 ms avg latency, 791.00 ms max latency.
  Latency distribution: 152 ms 50th, 482 ms 95th, 558 ms 99th, 756 ms 99.9th.
```

**Key Metrics Summary:**

| Metric                   | Value                               |
|--------------------------|-------------------------------------|
| **Overall Throughput**   | 119,660 records/sec (116.86 MB/sec) |
| **Average Latency**      | 213.55 ms                           |
| **Median Latency (p50)** | 152 ms                              |
| **p95 Latency**          | 482 ms                              |
| **p99 Latency**          | 558 ms                              |
| **p99.9 Latency**        | 756 ms                              |
| **Max Latency**          | 791 ms                              |

The initial spike in latency (379.9 ms) occurs during JVM warmup and broker connection establishment. 
Once the pipeline is primed, average latency drops to 213.55 ms.

### Consumer Performance Test

Now let's measure consumption throughput:

**Test Command:**
```bash
kafka-consumer-perf-test \
  --topic performance-test \
  --bootstrap-server localhost:9092 \
  --messages 1000000 \
  --show-detailed-stats
```

**Results:**
```
time, threadId, data.consumed.in.MB, MB.sec, data.consumed.in.nMsg, nMsg.sec, rebalance.time.ms, fetch.time.ms, fetch.MB.sec, fetch.nMsg.sec
2025-10-15 19:25:08:093, 0, 553.5879, 110.7176, 566874, 113374.8000, 4165, 835, 662.9795, 678891.0180
```

**Key Metrics Summary:**

| Metric               | Value                                |
|----------------------|--------------------------------------|
| **Data Consumed**    | 553.59 MB (566,874 messages)         |
| **Throughput**       | 110.72 MB/sec (113,375 messages/sec) |
| **Rebalance Time**   | 4.165 seconds                        |
| **Fetch Time**       | 835 ms                               |
| **Fetch Throughput** | 662.98 MB/sec (678,891 messages/sec) |

Consumer throughput (113,375 msg/sec) is comparable to producer throughput (119,660 msg/sec), demonstrating balanced cluster performance. 
The fetch throughput is significantly higher because it measures raw fetch rate without accounting for rebalancing overhead.

### Acks Configuration Impact

Testing different `acks` settings reveals the fundamental durability vs. performance trade-off in distributed systems.

#### Test 1: acks=1 (Leader Acknowledgment Only)

With `acks=1`, the producer receives acknowledgment as soon as the leader writes to its local log, without waiting for follower replication.

**Test Command:**
```bash
kafka-producer-perf-test \
  --topic performance-test \
  --num-records 500000 \
  --record-size 1024 \
  --throughput -1 \
  --producer-props \
    bootstrap.servers=localhost:9092 \
    acks=1 \
    linger.ms=10 \
    batch.size=32768
```

**Results:**
```
500000 records sent, 180440.3 records/sec (176.21 MB/sec), 10.72 ms avg latency, 114.00 ms max latency.
  Latency distribution: 2 ms 50th, 36 ms 95th, 51 ms 99th, 59 ms 99.9th.
```

#### Test 2: acks=all (All ISR Replicas)

With `acks=all`, the producer waits for all in-sync replicas to acknowledge, providing the strongest durability guarantee.

**Test Command:**
```bash
kafka-producer-perf-test \
  --topic performance-test \
  --num-records 500000 \
  --record-size 1024 \
  --throughput -1 \
  --producer-props \
    bootstrap.servers=localhost:9092 \
    acks=all \
    linger.ms=10 \
    batch.size=32768
```

**Results:**
```
500000 records sent, 198649.2 records/sec (193.99 MB/sec), 138.28 ms avg latency, 235.00 ms max latency.
  Latency distribution: 125 ms 50th, 217 ms 95th, 226 ms 99th, 232 ms 99.9th.
```

#### Comparison Analysis

| Configuration  | Throughput                      | Avg Latency        | p50                | p95             | p99               | p99.9             |
|----------------|---------------------------------|--------------------|--------------------|-----------------|-------------------|-------------------|
| **acks=1**     | 180,440 rec/sec (176.21 MB/sec) | 10.72 ms           | 2 ms               | 36 ms           | 51 ms             | 59 ms             |
| **acks=all**   | 198,649 rec/sec (193.99 MB/sec) | 138.28 ms          | 125 ms             | 217 ms          | 226 ms            | 232 ms            |
| **Difference** | +10% throughput                 | **+12.9× latency** | **+62.5× latency** | **+6× latency** | **+4.4× latency** | **+3.9× latency** |

**Key Observations:**

1. **Surprising Throughput Result:** `acks=all` achieved **10% higher throughput** than `acks=1`, which seems counterintuitive. This occurs because:
   - Batching efficiency: With higher latency, the producer accumulates larger batches before sending
   - Better pipelining: Multiple in-flight batches while waiting for ISR acknowledgments
   - Network efficiency: Fewer, larger network round-trips vs. many small ones

2. **Latency Trade-off:** `acks=all` incurs **12.9× higher average latency** and **62.5× higher median latency** because it waits for replication to all ISR members (3 brokers in our setup).

3. **Tail Latency Compression:** The p99.9/p50 ratio is lower for `acks=all` (1.86×) vs `acks=1` (29.5×), indicating more consistent, predictable latency under strong durability.

4. **Production Recommendation:** Despite higher latency, `acks=all` is recommended for most production workloads because:
   - **Zero data loss guarantee:** Messages are not lost even if the leader fails immediately after acknowledgment
   - **Higher throughput:** Counterintuitively faster due to batching
   - **Predictable latency:** Lower tail latency variance

Use `acks=1` only when:
- Latency is critical (< 10ms requirements)
- Data loss of recently acknowledged messages is acceptable
- You have application-level deduplication/retry logic

### Batch Size Impact

Testing different batch sizes:

```bash
# Small batches (4KB)
kafka-producer-perf-test \
  --topic performance-test \
  --num-records 100000 \
  --record-size 1024 \
  --throughput -1 \
  --producer-props \
    bootstrap.servers=localhost:9092 \
    acks=all \
    batch.size=4096
    
# 100000 records sent, 29180,0 records/sec (28,50 MB/sec), 714,47 ms avg latency, 1002,00 ms max latency, 737 ms 50th, 933 ms 95th, 982 ms 99th, 999 ms 99.9th.

# Medium batches (32KB - default)
# ... batch.size=32768
# 100000 records sent, 137551,6 records/sec (134,33 MB/sec), 115,49 ms avg latency, 197,00 ms max latency, 135 ms 50th, 189 ms 95th, 195 ms 99th, 196 ms 99.9th.

# Large batches (128KB)
# ... batch.size=131072
# 100000 records sent, 222717,1 records/sec (217,50 MB/sec), 6,39 ms avg latency, 128,00 ms max latency, 4 ms 50th, 15 ms 95th, 19 ms 99th, 22 ms 99.9th.
```

**My Results:**

| Batch Size | Throughput (rec/sec) | Avg Latency | Max Latency |
|------------|----------------------|-------------|-------------|
| 4KB        | 29180,0              | 714,47 ms   | 1002,00 ms  |
| 32KB       | 137551,6             | 115,49 ms   | 197,00 ms   |
| 128KB      | 222717,1             | 6,39 ms     | 128,00 ms   |

**Key Observations:**

1. **Dramatic Throughput Improvement:** Increasing batch size from 4KB to 128KB yielded a **7.6× throughput increase** (from 29,180 to 222,717 records/sec)
   - 4KB → 32KB: **4.7× improvement** (most significant gain)
   - 32KB → 128KB: **1.6× improvement** (diminishing returns)

2. **Latency Trade-off:** Larger batches significantly reduce average latency:
   - 4KB: 714.47 ms (waiting for small batches to fill under `acks=all`)
   - 32KB: 115.49 ms (**6.2× faster**)
   - 128KB: 6.39 ms (**111.8× faster** than 4KB, **18× faster** than 32KB)

## Runtime Verification Through Log Analysis

Now let's verify Kafka's replication protocol behavior by analyzing broker logs.

### Enable Debug Logging

We can use dynamic configuration change of such logger using:
```bash
kafka-configs --bootstrap-server localhost:9092 --alter --entity-type broker-loggers --entity-name 1 --add-config kafka.cluster.Partition=DEBUG,kafka.server.ReplicaManager=DEBUG,kafka.server.DefaultAlterPartitionManager=DEBUG
```
There is no need to restart broker.
Note, that you should be able to change it ONLY on leader! 
We should see the change immediately:
```
...
nd log start offset 0. (kafka.cluster.Partition)
[2025-10-15 19:55:30,136] DEBUG [Partition __consumer_offsets-31 broker=2] Recorded replica 1 log end offset (LEO) position 0 and log start offset 0. (kafka.cluster.Partition)
[2025-10-15 19:55:30,137] DEBUG [Partition __consumer_offsets-27 broker=2] Recorded replica 1 log end offset (LEO) position 0 and log start offset 0. (kafka.cluster.Partition)
[2025-10-15 19:55:30,137] DEBUG [Partition __consumer_offsets-25 broker=2] Recorded replica 1 log end offset (LEO) position 0 and log start offset 0. (kafka.cluster.Partition)
[2025-10-15 19:55:30,137] DEBUG [Partition __consumer_offsets-39 broker=2] Recorded replica 1 log end offset (LEO) position 0 and log start offset 0. (kafka.cluster.Partition)
[2025-10-15 19:55:30,137] DEBUG [Partition __consumer_offsets-8 broker=2] Recorded replica 1 log end offset (LEO) position 0 and log start offset 0. (kafka.cluster.Partition)
[2025-10-15 19:55:30,137] DEBUG [Partition __consumer_offsets-35 broker=2] Recorded replica 1 log end offset (LEO) position 0 and log start offset 0. (kafka.cluster.Partition)
[2025-10-15 19:55:30,138] DEBUG [Partition performance-test-0 broker=2] Recorded replica 1 log end offset (LEO) position 771005 and log start offset 0. (kafka.cluster.Partition)
...
```

### Test 1: Verifying ISR Expansion

**Scenario:** Stop a follower, produce data, restart follower, watch it rejoin ISR.

**Step 1: Stop Broker 3**
```bash
# In broker 3's terminal, press Ctrl+C
```

**Step 2: Produce Data**
```bash
kafka-producer-perf-test \
  --topic performance-test \
  --num-records 10000 \
  --record-size 1024 \
  --throughput 100 \
  --producer-props bootstrap.servers=localhost:9092 acks=all
```

**Step 3: Check ISR Status**
```bash
kafka-topics --describe \
  --topic performance-test \
  --bootstrap-server localhost:9092
```

**Observed Output:**
```
Topic: performance-test Partition: 0    Leader: 2       Replicas: 2,3,1 Isr: 2,1        Elr:    LastKnownElr:
Topic: performance-test Partition: 1    Leader: 1       Replicas: 3,1,2 Isr: 2,1        Elr:    LastKnownElr:
Topic: performance-test Partition: 2    Leader: 1       Replicas: 1,2,3 Isr: 2,1        Elr:    LastKnownElr:
```

Notice broker 3 is removed from ISR for all partitions.

**Runtime Verification Result:** ISR shrink triggered **immediately** upon broker failure detection (via session timeout/heartbeat mechanism), not after `replica.lag.time.max.ms`. The `replica.lag.time.max.ms` timeout only applies when the broker is alive but lagging in replication.

**Step 4: Start Broker 3**
```bash
kafka-server-start config/kraft/server-3.properties
```

**Step 5: Monitor Logs for ISR Expansion**

In Broker 1's log:
```
[2025-10-15 20:36:54,506] INFO [Partition __consumer_offsets-1 broker=1] ISR updated to 2,1,3  and version updated to 18 (kafka.cluster.Partition)
2025-10-15 20:36:54,507] INFO [GroupCoordinator id=1] Scheduling unloading of metadata for __consumer_offsets-48 with epoch OptionalInt[5] (org.apache.kafka.coordinator.common.runtime.CoordinatorRuntime)
[2025-10-15 20:36:54,507] INFO [GroupCoordinator id=1] Scheduling unloading of metadata for __consumer_offsets-13 with epoch OptionalInt[5] (org.apache.kafka.coordinator.common.runtime.CoordinatorRuntime)
...
[2025-10-15 20:38:45,018] INFO [ReplicaFetcher replicaId=1, leaderId=3, fetcherId=0] Truncating partition performance-test-1 with TruncationState(offset=768982, completed=true) due to leader epoch and offset EpochEndOffset(errorCode=0, partition=1, leaderEpoch=5, endOffset=768982) (kafka.server.ReplicaFetcherThread)
[2025-10-15 20:38:45,018] INFO [UnifiedLog partition=performance-test-1, dir=/tmp/kafka-logs-1] Truncating to 768982 has no effect as the largest offset in the log is 768981 (org.apache.kafka.storage.internals.log.UnifiedLog)
[2025-10-15 20:38:45,018] INFO [ReplicaFetcher replicaId=1, leaderId=3, fetcherId=0] Truncating partition __consumer_offsets-41 with TruncationState(offset=6, completed=true) due to leader epoch and offset EpochEndOffset(errorCode=0, partition=41, leaderEpoch=0, endOffset=6) (kafka.server.ReplicaFetcherThread)
[2025-10-15 20:38:45,018] INFO [UnifiedLog partition=__consumer_offsets-41, dir=/tmp/kafka-logs-1] Truncating to 6 has no effect as the largest offset in the log is 5 (org.apache.kafka.storage.internals.log.UnifiedLog)
```

This confirms the ISR expansion logic from `Partition.scala:1176` that we explored in the [replication protocol post](/posts/kafka-internals-replication-protocol).

### Test 2: Verifying High Watermark Advancement 

**Scenario:** Produce with `acks=all` and verify HW advances only after ISR replication.

Before we proceed double-check who is your leader, in my case when `kafka-metadata-quorum --bootstrap-server localhost:9092 describe --status`:
```
ClusterId:              2deHMQffRNKvijX3ctYkkg
LeaderId:               1
LeaderEpoch:            12
HighWatermark:          23603
MaxFollowerLag:         0
MaxFollowerLagTimeMs:   0
CurrentVoters:          [{"id": 1, "endpoints": ["CONTROLLER://localhost:9093"]}, {"id": 2, "endpoints": ["CONTROLLER://localhost:9094"]}, {"id": 3, "endpoints": ["CONTROLLER://localhost:9095"]}]
CurrentObservers:       []
```
The leader is Broker with `ID=1`. So we need to check the logs of the Broker 1.

**Step 1: Enable Trace Logging**

```bash
kafka-configs --bootstrap-server localhost:19092 --alter --entity-type broker-loggers --entity-name 2 --add-config kafka.cluster.Partition=TRACE
```
**Step 2: Produce Single Batch**
```bash
echo "test-message" | kafka-console-producer \
  --topic performance-test \
  --bootstrap-server localhost:9092 \
  --property acks=all
```

**Step 3: Analyze Leader Logs**

In Broker 1's log (leader for partition 2), you'll see detailed TRACE-level output showing the high watermark advancement process. The actual logs are more verbose than older Kafka versions, showing segment metadata and granular ISR acknowledgment tracking:

```
...
# Example: Offset 88 → 89 progression
[2025-10-16 15:57:12,612] TRACE [Partition performance-test-2 broker=1] Skipping update high watermark since new hw (offset=88, segment=[16:76938]) is not larger than old value. All current LEOs are Set(replica 2: (offset=88, segment=[16:76938]), replica 3: (offset=88, segment=[16:76938]), replica 1: (offset=89, segment=[16:78032])) (kafka.cluster.Partition)
[2025-10-16 15:57:12,612] TRACE [Partition performance-test-2 broker=1] Progress awaiting ISR acks for offset 89: acked: Set(broker 1: 89), awaiting Set(broker 3: 88, broker 2: 88) (kafka.cluster.Partition)
[2025-10-16 15:57:12,612] TRACE [Partition performance-test-2 broker=1] Progress awaiting ISR acks for offset 89: acked: Set(broker 1: 89), awaiting Set(broker 3: 88, broker 2: 88) (kafka.cluster.Partition)
[2025-10-16 15:57:12,614] TRACE [Partition performance-test-2 broker=1] Skipping update high watermark since new hw (offset=88, segment=[16:76938]) is not larger than old value. All current LEOs are Set(replica 2: (offset=89, segment=[16:78032]), replica 3: (offset=88, segment=[16:76938]), replica 1: (offset=89, segment=[16:78032])) (kafka.cluster.Partition)
[2025-10-16 15:57:12,614] DEBUG [Partition performance-test-2 broker=1] High watermark updated from (offset=88, segment=[16:76938]) to (offset=89, segment=[16:78032]) (kafka.cluster.Partition)
[2025-10-16 15:57:12,614] TRACE [Partition performance-test-2 broker=1] Progress awaiting ISR acks for offset 89: acked: Set(broker 3: 89, broker 2: 89, broker 1: 89), awaiting Set() (kafka.cluster.Partition)
[2025-10-16 15:57:12,622] TRACE [Partition performance-test-2 broker=1] Skipping update high watermark since new hw (offset=89, segment=[16:78032]) is not larger than old value. All current LEOs are Set(replica 2: (offset=89, segment=[16:78032]), replica 3: (offset=89, segment=[16:78032]), replica 1: (offset=90, segment=[16:79126])) (kafka.cluster.Partition)
[2025-10-16 15:57:12,623] TRACE [Partition performance-test-2 broker=1] Progress awaiting ISR acks for offset 90: acked: Set(broker 1: 90), awaiting Set(broker 3: 89, broker 2: 89) (kafka.cluster.Partition)
[2025-10-16 15:57:12,623] TRACE [Partition performance-test-2 broker=1] Progress awaiting ISR acks for offset 90: acked: Set(broker 1: 90), awaiting Set(broker 3: 89, broker 2: 89) (kafka.cluster.Partition)
[2025-10-16 15:57:12,624] TRACE [Partition performance-test-2 broker=1] Skipping update high watermark since new hw (offset=89, segment=[16:78032]) is not larger than old value. All current LEOs are Set(replica 2: (offset=90, segment=[16:79126]), replica 3: (offset=89, segment=[16:78032]), replica 1: (offset=90, segment=[16:79126])) (kafka.cluster.Partition)
[2025-10-16 15:57:12,624] DEBUG [Partition performance-test-2 broker=1] High watermark updated from (offset=89, segment=[16:78032]) to (offset=90, segment=[16:79126]) (kafka.cluster.Partition)
[2025-10-16 15:57:12,624] TRACE [Partition performance-test-2 broker=1] Progress awaiting ISR acks for offset 90: acked: Set(broker 3: 90, broker 2: 90, broker 1: 90), awaiting Set() (kafka.cluster.Partition)
[2025-10-16 15:57:12,632] TRACE [Partition performance-test-2 broker=1] Skipping update high watermark since new hw (offset=90, segment=[16:79126]) is not larger than old value. All current LEOs are Set(replica 2: (offset=90, segment=[16:79126]), replica 3: (offset=90, segment=[16:79126]), replica 1: (offset=91, segment=[16:80220])) (kafka.cluster.Partition)
[2025-10-16 15:57:12,632] TRACE [Partition performance-test-2 broker=1] Progress awaiting ISR acks for offset 91: acked: Set(broker 1: 91), awaiting Set(broker 3: 90, broker 2: 90) (kafka.cluster.Partition)
[2025-10-16 15:57:12,632] TRACE [Partition performance-test-2 broker=1] Progress awaiting ISR acks for offset 91: acked: Set(broker 1: 91), awaiting Set(broker 3: 90, broker 2: 90) (kafka.cluster.Partition)
[2025-10-16 15:57:12,633] TRACE [Partition performance-test-2 broker=1] Skipping update high watermark since new hw (offset=90, segment=[16:79126]) is not larger than old value. All current LEOs are Set(replica 2: (offset=91, segment=[16:80220]), replica 3: (offset=90, segment=[16:79126]), replica 1: (offset=91, segment=[16:80220])) (kafka.cluster.Partition)
[2025-10-16 15:57:12,633] DEBUG [Partition performance-test-2 broker=1] High watermark updated from (offset=90, segment=[16:79126]) to (offset=91, segment=[16:80220]) (kafka.cluster.Partition)
[2025-10-16 15:57:12,633] TRACE [Partition performance-test-2 broker=1] Progress awaiting ISR acks for offset 91: acked: Set(broker 3: 91, broker 2: 91, broker 1: 91), awaiting Set() (kafka.cluster.Partition)
[2025-10-16 15:57:12,645] TRACE [Partition performance-test-2 broker=1] Skipping update high watermark since new hw (offset=91, segment=[16:80220]) is not larger than old value. All current LEOs are Set(replica 2: (offset=91, segment=[16:80220]), replica 3: (offset=91, segment=[16:80220]), replica 1: (offset=92, segment=[16:81314])) (kafka.cluster.Partition)
[2025-10-16 15:57:12,645] TRACE [Partition performance-test-2 broker=1] Progress awaiting ISR acks for offset 92: acked: Set(broker 1: 92), awaiting Set(broker 3: 91, broker 2: 91) (kafka.cluster.Partition)
[2025-10-16 15:57:12,645] TRACE [Partition performance-test-2 broker=1] Progress awaiting ISR acks for offset 92: acked: Set(broker 1: 92), awaiting Set(broker 3: 91, broker 2: 91) (kafka.cluster.Partition)
[2025-10-16 15:57:12,646] TRACE [Partition performance-test-2 broker=1] Skipping update high watermark since new hw (offset=91, segment=[16:80220]) is not larger than old value. All current LEOs are Set(replica 2: (offset=91, segment=[16:80220]), replica 3: (offset=92, segment=[16:81314]), replica 1: (offset=92, segment=[16:81314])) (kafka.cluster.Partition)
[2025-10-16 15:57:12,646] DEBUG [Partition performance-test-2 broker=1] High watermark updated from (offset=91, segment=[16:80220]) to (offset=92, segment=[16:81314]) (kafka.cluster.Partition)
[2025-10-16 15:57:12,646] TRACE [Partition performance-test-2 broker=1] Progress awaiting ISR acks for offset 92: acked: Set(broker 3: 92, broker 2: 92, broker 1: 92), awaiting Set() (kafka.cluster.Partition)
[2025-10-16 15:57:12,658] TRACE [Partition performance-test-2 broker=1] Skipping update high watermark since new hw (offset=92, segment=[16:81314]) is not larger than old value. All current LEOs are Set(replica 2: (offset=92, segment=[16:81314]), replica 3: (offset=92, segment=[16:81314]), replica 1: (offset=94, segment=[16:83441])) (kafka.cluster.Partition)
[2025-10-16 15:57:12,658] TRACE [Partition performance-test-2 broker=1] Progress awaiting ISR acks for offset 94: acked: Set(broker 1: 94), awaiting Set(broker 3: 92, broker 2: 92) (kafka.cluster.Partition)
[2025-10-16 15:57:12,658] TRACE [Partition performance-test-2 broker=1] Progress awaiting ISR acks for offset 94: acked: Set(broker 1: 94), awaiting Set(broker 3: 92, broker 2: 92) (kafka.cluster.Partition)
[2025-10-16 15:57:12,659] TRACE [Partition performance-test-2 broker=1] Skipping update high watermark since new hw (offset=92, segment=[16:81314]) is not larger than old value. All current LEOs are Set(replica 2: (offset=92, segment=[16:81314]), replica 3: (offset=94, segment=[16:83441]), replica 1: (offset=94, segment=[16:83441])) (kafka.cluster.Partition)
[2025-10-16 15:57:12,659] DEBUG [Partition performance-test-2 broker=1] High watermark updated from (offset=92, segment=[16:81314]) to (offset=94, segment=[16:83441]) (kafka.cluster.Partition)
[2025-10-16 15:57:12,659] TRACE [Partition performance-test-2 broker=1] Progress awaiting ISR acks for offset 94: acked: Set(broker 3: 94, broker 2: 94, broker 1: 94), awaiting Set() (kafka.cluster.Partition)
[2025-10-16 15:57:12,670] TRACE [Partition performance-test-2 broker=1] Skipping update high watermark since new hw (offset=94, segment=[16:83441]) is not larger than old value. All current LEOs are Set(replica 2: (offset=94, segment=[16:83441]), replica 3: (offset=94, segment=[16:83441]), replica 1: (offset=95, segment=[16:84535])) (kafka.cluster.Partition)
[2025-10-16 15:57:12,670] TRACE [Partition performance-test-2 broker=1] Progress awaiting ISR acks for offset 95: acked: Set(broker 1: 95), awaiting Set(broker 3: 94, broker 2: 94) (kafka.cluster.Partition)
[2025-10-16 15:57:12,670] TRACE [Partition performance-test-2 broker=1] Progress awaiting ISR acks for offset 95: acked: Set(broker 1: 95), awaiting Set(broker 3: 94, broker 2: 94) (kafka.cluster.Partition)
[2025-10-16 15:57:12,671] TRACE [Partition performance-test-2 broker=1] Skipping update high watermark since new hw (offset=94, segment=[16:83441]) is not larger than old value. All current LEOs are Set(replica 2: (offset=94, segment=[16:83441]), replica 3: (offset=95, segment=[16:84535]), replica 1: (offset=95, segment=[16:84535])) (kafka.cluster.Partition)
[2025-10-16 15:57:12,671] DEBUG [Partition performance-test-2 broker=1] High watermark updated from (offset=94, segment=[16:83441]) to (offset=95, segment=[16:84535]) (kafka.cluster.Partition)
[2025-10-16 15:57:12,671] TRACE [Partition performance-test-2 broker=1] Progress awaiting ISR acks for offset 95: acked: Set(broker 3: 95, broker 2: 95, broker 1: 95), awaiting Set() (kafka.cluster.Partition)
[2025-10-16 15:57:12,683] TRACE [Partition performance-test-2 broker=1] Skipping update high watermark since new hw (offset=95, segment=[16:84535]) is not larger than old value. All current LEOs are Set(replica 2: (offset=95, segment=[16:84535]), replica 3: (offset=95, segment=[16:84535]), replica 1: (offset=96, segment=[16:85629])) (kafka.cluster.Partition)
[2025-10-16 15:57:12,683] TRACE [Partition performance-test-2 broker=1] Progress awaiting ISR acks for offset 96: acked: Set(broker 1: 96), awaiting Set(broker 3: 95, broker 2: 95) (kafka.cluster.Partition)
[2025-10-16 15:57:12,683] TRACE [Partition performance-test-2 broker=1] Progress awaiting ISR acks for offset 96: acked: Set(broker 1: 96), awaiting Set(broker 3: 95, broker 2: 95) (kafka.cluster.Partition)
[2025-10-16 15:57:12,684] TRACE [Partition performance-test-2 broker=1] Skipping update high watermark since new hw (offset=95, segment=[16:84535]) is not larger than old value. All current LEOs are Set(replica 2: (offset=95, segment=[16:84535]), replica 3: (offset=96, segment=[16:85629]), replica 1: (offset=96, segment=[16:85629])) (kafka.cluster.Partition)
[2025-10-16 15:57:12,684] DEBUG [Partition performance-test-2 broker=1] High watermark updated from (offset=95, segment=[16:84535]) to (offset=96, segment=[16:85629]) (kafka.cluster.Partition)
[2025-10-16 15:57:12,684] TRACE [Partition performance-test-2 broker=1] Progress awaiting ISR acks for offset 96: acked: Set(broker 3: 96, broker 2: 96, broker 1: 96), awaiting Set() (kafka.cluster.Partition)
[2025-10-16 15:57:12,693] TRACE [Partition performance-test-2 broker=1] Skipping update high watermark since new hw (offset=96, segment=[16:85629]) is not larger than old value. All current LEOs are Set(replica 2: (offset=96, segment=[16:85629]), replica 3: (offset=96, segment=[16:85629]), replica 1: (offset=97, segment=[16:86723])) (kafka.cluster.Partition)
[2025-10-16 15:57:12,693] TRACE [Partition performance-test-2 broker=1] Progress awaiting ISR acks for offset 97: acked: Set(broker 1: 97), awaiting Set(broker 3: 96, broker 2: 96) (kafka.cluster.Partition)
[2025-10-16 15:57:12,693] TRACE [Partition performance-test-2 broker=1] Progress awaiting ISR acks for offset 97: acked: Set(broker 1: 97), awaiting Set(broker 3: 96, broker 2: 96) (kafka.cluster.Partition)
[2025-10-16 15:57:12,694] TRACE [Partition performance-test-2 broker=1] Skipping update high watermark since new hw (offset=96, segment=[16:85629]) is not larger than old value. All current LEOs are Set(replica 2: (offset=96, segment=[16:85629]), replica 3: (offset=97, segment=[16:86723]), replica 1: (offset=97, segment=[16:86723])) (kafka.cluster.Partition)
[2025-10-16 15:57:12,694] DEBUG [Partition performance-test-2 broker=1] High watermark updated from (offset=96, segment=[16:85629]) to (offset=97, segment=[16:86723]) (kafka.cluster.Partition)
[2025-10-16 15:57:12,694] TRACE [Partition performance-test-2 broker=1] Progress awaiting ISR acks for offset 97: acked: Set(broker 3: 97, broker 2: 97, broker 1: 97), awaiting Set() (kafka.cluster.Partition)
[2025-10-16 15:57:12,704] TRACE [Partition performance-test-2 broker=1] Skipping update high watermark since new hw (offset=97, segment=[16:86723]) is not larger than old value. All current LEOs are Set(replica 2: (offset=97, segment=[16:86723]), replica 3: (offset=97, segment=[16:86723]), replica 1: (offset=98, segment=[16:87817])) (kafka.cluster.Partition)
[2025-10-16 15:57:12,704] TRACE [Partition performance-test-2 broker=1] Progress awaiting ISR acks for offset 98: acked: Set(broker 1: 98), awaiting Set(broker 3: 97, broker 2: 97) (kafka.cluster.Partition)
[2025-10-16 15:57:12,704] TRACE [Partition performance-test-2 broker=1] Progress awaiting ISR acks for offset 98: acked: Set(broker 1: 98), awaiting Set(broker 3: 97, broker 2: 97) (kafka.cluster.Partition)
[2025-10-16 15:57:12,705] TRACE [Partition performance-test-2 broker=1] Skipping update high watermark since new hw (offset=97, segment=[16:86723]) is not larger than old value. All current LEOs are Set(replica 2: (offset=98, segment=[16:87817]), replica 3: (offset=97, segment=[16:86723]), replica 1: (offset=98, segment=[16:87817])) (kafka.cluster.Partition)
[2025-10-16 15:57:12,705] DEBUG [Partition performance-test-2 broker=1] High watermark updated from (offset=97, segment=[16:86723]) to (offset=98, segment=[16:87817]) (kafka.cluster.Partition)
[2025-10-16 15:57:12,705] TRACE [Partition performance-test-2 broker=1] Progress awaiting ISR acks for offset 98: acked: Set(broker 3: 98, broker 2: 98, broker 1: 98), awaiting Set() (kafka.cluster.Partition)
[2025-10-16 15:57:12,717] TRACE [Partition performance-test-2 broker=1] Skipping update high watermark since new hw (offset=98, segment=[16:87817]) is not larger than old value. All current LEOs are Set(replica 2: (offset=98, segment=[16:87817]), replica 3: (offset=98, segment=[16:87817]), replica 1: (offset=100, segment=[16:89944])) (kafka.cluster.Partition)
[2025-10-16 15:57:12,717] TRACE [Partition performance-test-2 broker=1] Progress awaiting ISR acks for offset 100: acked: Set(broker 1: 100), awaiting Set(broker 3: 98, broker 2: 98) (kafka.cluster.Partition)
[2025-10-16 15:57:12,717] TRACE [Partition performance-test-2 broker=1] Progress awaiting ISR acks for offset 100: acked: Set(broker 1: 100), awaiting Set(broker 3: 98, broker 2: 98) (kafka.cluster.Partition)
[2025-10-16 15:57:12,718] TRACE [Partition performance-test-2 broker=1] Skipping update high watermark since new hw (offset=98, segment=[16:87817]) is not larger than old value. All current LEOs are Set(replica 2: (offset=98, segment=[16:87817]), replica 3: (offset=100, segment=[16:89944]), replica 1: (offset=100, segment=[16:89944])) (kafka.cluster.Partition)
[2025-10-16 15:57:12,718] DEBUG [Partition performance-test-2 broker=1] High watermark updated from (offset=98, segment=[16:87817]) to (offset=100, segment=[16:89944]) (kafka.cluster.Partition)
[2025-10-16 15:57:12,718] TRACE [Partition performance-test-2 broker=1] Progress awaiting ISR acks for offset 100: acked: Set(broker 3: 100, broker 2: 100, broker 1: 100), awaiting Set() (kafka.cluster.Partition)
[2025-10-16 15:57:12,729] TRACE [Partition performance-test-2 broker=1] Skipping update high watermark since new hw (offset=100, segment=[16:89944]) is not larger than old value. All current LEOs are Set(replica 2: (offset=100, segment=[16:89944]), replica 3: (offset=100, segment=[16:89944]), replica 1: (offset=101, segment=[16:91038])) (kafka.cluster.Partition)
[2025-10-16 15:57:12,729] TRACE [Partition performance-test-2 broker=1] Progress awaiting ISR acks for offset 101: acked: Set(broker 1: 101), awaiting Set(broker 3: 100, broker 2: 100) (kafka.cluster.Partition)
[2025-10-16 15:57:12,729] TRACE [Partition performance-test-2 broker=1] Progress awaiting ISR acks for offset 101: acked: Set(broker 1: 101), awaiting Set(broker 3: 100, broker 2: 100) (kafka.cluster.Partition)
[2025-10-16 15:57:12,730] TRACE [Partition performance-test-2 broker=1] Skipping update high watermark since new hw (offset=100, segment=[16:89944]) is not larger than old value. All current LEOs are Set(replica 2: (offset=100, segment=[16:89944]), replica 3: (offset=101, segment=[16:91038]), replica 1: (offset=101, segment=[16:91038])) (kafka.cluster.Partition)
[2025-10-16 15:57:12,730] DEBUG [Partition performance-test-2 broker=1] High watermark updated from (offset=100, segment=[16:89944]) to (offset=101, segment=[16:91038]) (kafka.cluster.Partition)
[2025-10-16 15:57:12,730] TRACE [Partition performance-test-2 broker=1] Progress awaiting ISR acks for offset 101: acked: Set(broker 3: 101, broker 2: 101, broker 1: 101), awaiting Set() (kafka.cluster.Partition)
[2025-10-16 15:57:12,742] TRACE [Partition performance-test-2 broker=1] Skipping update high watermark since new hw (offset=101, segment=[16:91038]) is not larger than old value. All current LEOs are Set(replica 2: (offset=101, segment=[16:91038]), replica 3: (offset=101, segment=[16:91038]), replica 1: (offset=102, segment=[16:92132])) (kafka.cluster.Partition)
[2025-10-16 15:57:12,742] TRACE [Partition performance-test-2 broker=1] Progress awaiting ISR acks for offset 102: acked: Set(broker 1: 102), awaiting Set(broker 3: 101, broker 2: 101) (kafka.cluster.Partition)
[2025-10-16 15:57:12,742] TRACE [Partition performance-test-2 broker=1] Progress awaiting ISR acks for offset 102: acked: Set(broker 1: 102), awaiting Set(broker 3: 101, broker 2: 101) (kafka.cluster.Partition)
[2025-10-16 15:57:12,743] TRACE [Partition performance-test-2 broker=1] Skipping update high watermark since new hw (offset=101, segment=[16:91038]) is not larger than old value. All current LEOs are Set(replica 2: (offset=102, segment=[16:92132]), replica 3: (offset=101, segment=[16:91038]), replica 1: (offset=102, segment=[16:92132])) (kafka.cluster.Partition)
[2025-10-16 15:57:12,743] DEBUG [Partition performance-test-2 broker=1] High watermark updated from (offset=101, segment=[16:91038]) to (offset=102, segment=[16:92132]) (kafka.cluster.Partition)
[2025-10-16 15:57:12,743] TRACE [Partition performance-test-2 broker=1] Progress awaiting ISR acks for offset 102: acked: Set(broker 3: 102, broker 2: 102, broker 1: 102), awaiting Set() (kafka.cluster.Partition)
[2025-10-16 15:57:12,755] TRACE [Partition performance-test-2 broker=1] Skipping update high watermark since new hw (offset=102, segment=[16:92132]) is not larger than old value. All current LEOs are Set(replica 2: (offset=102, segment=[16:92132]), replica 3: (offset=102, segment=[16:92132]), replica 1: (offset=103, segment=[16:93226])) (kafka.cluster.Partition)
[2025-10-16 15:57:12,755] TRACE [Partition performance-test-2 broker=1] Progress awaiting ISR acks for offset 103: acked: Set(broker 1: 103), awaiting Set(broker 3: 102, broker 2: 102) (kafka.cluster.Partition)
[2025-10-16 15:57:12,755] TRACE [Partition performance-test-2 broker=1] Progress awaiting ISR acks for offset 103: acked: Set(broker 1: 103), awaiting Set(broker 3: 102, broker 2: 102) (kafka.cluster.Partition)
[2025-10-16 15:57:12,756] TRACE [Partition performance-test-2 broker=1] Skipping update high watermark since new hw (offset=102, segment=[16:92132]) is not larger than old value. All current LEOs are Set(replica 2: (offset=103, segment=[16:93226]), replica 3: (offset=102, segment=[16:92132]), replica 1: (offset=103, segment=[16:93226])) (kafka.cluster.Partition)
[2025-10-16 15:57:12,756] DEBUG [Partition performance-test-2 broker=1] High watermark updated from (offset=102, segment=[16:92132]) to (offset=103, segment=[16:93226]) (kafka.cluster.Partition)
[2025-10-16 15:57:12,756] TRACE [Partition performance-test-2 broker=1] Progress awaiting ISR acks for offset 103: acked: Set(broker 3: 103, broker 2: 103, broker 1: 103), awaiting Set() (kafka.cluster.Partition)
[2025-10-16 15:57:12,767] TRACE [Partition performance-test-2 broker=1] Skipping update high watermark since new hw (offset=103, segment=[16:93226]) is not larger than old value. All current LEOs are Set(replica 2: (offset=103, segment=[16:93226]), replica 3: (offset=103, segment=[16:93226]), replica 1: (offset=105, segment=[16:95353])) (kafka.cluster.Partition)
[2025-10-16 15:57:12,767] TRACE [Partition performance-test-2 broker=1] Progress awaiting ISR acks for offset 105: acked: Set(broker 1: 105), awaiting Set(broker 3: 103, broker 2: 103) (kafka.cluster.Partition)
[2025-10-16 15:57:12,768] TRACE [Partition performance-test-2 broker=1] Progress awaiting ISR acks for offset 105: acked: Set(broker 1: 105), awaiting Set(broker 3: 103, broker 2: 103) (kafka.cluster.Partition)
[2025-10-16 15:57:12,768] TRACE [Partition performance-test-2 broker=1] Skipping update high watermark since new hw (offset=103, segment=[16:93226]) is not larger than old value. All current LEOs are Set(replica 2: (offset=105, segment=[16:95353]), replica 3: (offset=103, segment=[16:93226]), replica 1: (offset=105, segment=[16:95353])) (kafka.cluster.Partition)
[2025-10-16 15:57:12,768] DEBUG [Partition performance-test-2 broker=1] High watermark updated from (offset=103, segment=[16:93226]) to (offset=105, segment=[16:95353]) (kafka.cluster.Partition)
[2025-10-16 15:57:12,768] TRACE [Partition performance-test-2 broker=1] Progress awaiting ISR acks for offset 105: acked: Set(broker 3: 105, broker 2: 105, broker 1: 105), awaiting Set() (kafka.cluster.Partition)
[2025-10-16 15:57:13,263] TRACE [Partition performance-test-2 broker=1] Skipping update high watermark since new hw (offset=105, segment=[16:95353]) is not larger than old value. All current LEOs are Set(replica 2: (offset=105, segment=[16:95353]), replica 3: (offset=105, segment=[16:95353]), replica 1: (offset=106, segment=[16:96447])) (kafka.cluster.Partition)
[2025-10-16 15:57:13,263] TRACE [Partition performance-test-2 broker=1] Progress awaiting ISR acks for offset 106: acked: Set(broker 1: 106), awaiting Set(broker 3: 105, broker 2: 105) (kafka.cluster.Partition)
[2025-10-16 15:57:13,263] TRACE [Partition performance-test-2 broker=1] Progress awaiting ISR acks for offset 106: acked: Set(broker 1: 106), awaiting Set(broker 3: 105, broker 2: 105) (kafka.cluster.Partition)
[2025-10-16 15:57:13,265] DEBUG [Partition performance-test-2 broker=1] High watermark updated from (offset=105, segment=[16:95353]) to (offset=106, segment=[16:96447]) (kafka.cluster.Partition)
[2025-10-16 15:57:13,265] TRACE [Partition performance-test-2 broker=1] Skipping update high watermark since new hw (offset=105, segment=[16:95353]) is not larger than old value. All current LEOs are Set(replica 2: (offset=106, segment=[16:96447]), replica 3: (offset=106, segment=[16:96447]), replica 1: (offset=106, segment=[16:96447])) (kafka.cluster.Partition)
[2025-10-16 15:57:13,265] TRACE [Partition performance-test-2 broker=1] Progress awaiting ISR acks for offset 106: acked: Set(broker 3: 106, broker 2: 106, broker 1: 106), awaiting Set() (kafka.cluster.Partition)
[2025-10-16 15:57:13,276] TRACE [Partition performance-test-2 broker=1] Skipping update high watermark since new hw (offset=106, segment=[16:96447]) is not larger than old value. All current LEOs are Set(replica 2: (offset=106, segment=[16:96447]), replica 3: (offset=106, segment=[16:96447]), replica 1: (offset=107, segment=[16:97541])) (kafka.cluster.Partition)
[2025-10-16 15:57:13,276] TRACE [Partition performance-test-2 broker=1] Progress awaiting ISR acks for offset 107: acked: Set(broker 1: 107), awaiting Set(broker 3: 106, broker 2: 106) (kafka.cluster.Partition)
[2025-10-16 15:57:13,276] TRACE [Partition performance-test-2 broker=1] Progress awaiting ISR acks for offset 107: acked: Set(broker 1: 107), awaiting Set(broker 3: 106, broker 2: 106) (kafka.cluster.Partition)
[2025-10-16 15:57:13,278] DEBUG [Partition performance-test-2 broker=1] High watermark updated from (offset=106, segment=[16:96447]) to (offset=107, segment=[16:97541]) (kafka.cluster.Partition)
[2025-10-16 15:57:13,278] TRACE [Partition performance-test-2 broker=1] Skipping update high watermark since new hw (offset=106, segment=[16:96447]) is not larger than old value. All current LEOs are Set(replica 2: (offset=107, segment=[16:97541]), replica 3: (offset=107, segment=[16:97541]), replica 1: (offset=107, segment=[16:97541])) (kafka.cluster.Partition)
[2025-10-16 15:57:13,278] TRACE [Partition performance-test-2 broker=1] Progress awaiting ISR acks for offset 107: acked: Set(broker 3: 107, broker 2: 107, broker 1: 107), awaiting Set() (kafka.cluster.Partition)
[2025-10-16 15:57:13,288] TRACE [Partition performance-test-2 broker=1] Skipping update high watermark since new hw (offset=107, segment=[16:97541]) is not larger than old value. All current LEOs are Set(replica 2: (offset=107, segment=[16:97541]), replica 3: (offset=107, segment=[16:97541]), replica 1: (offset=109, segment=[16:99668])) (kafka.cluster.Partition)
[2025-10-16 15:57:13,288] TRACE [Partition performance-test-2 broker=1] Progress awaiting ISR acks for offset 109: acked: Set(broker 1: 109), awaiting Set(broker 3: 107, broker 2: 107) (kafka.cluster.Partition)
[2025-10-16 15:57:13,288] TRACE [Partition performance-test-2 broker=1] Progress awaiting ISR acks for offset 109: acked: Set(broker 1: 109), awaiting Set(broker 3: 107, broker 2: 107) (kafka.cluster.Partition)
[2025-10-16 15:57:13,290] TRACE [Partition performance-test-2 broker=1] Skipping update high watermark since new hw (offset=107, segment=[16:97541]) is not larger than old value. All current LEOs are Set(replica 2: (offset=109, segment=[16:99668]), replica 3: (offset=107, segment=[16:97541]), replica 1: (offset=109, segment=[16:99668])) (kafka.cluster.Partition)
[2025-10-16 15:57:13,290] DEBUG [Partition performance-test-2 broker=1] High watermark updated from (offset=107, segment=[16:97541]) to (offset=109, segment=[16:99668]) (kafka.cluster.Partition)
[2025-10-16 15:57:13,290] TRACE [Partition performance-test-2 broker=1] Progress awaiting ISR acks for offset 109: acked: Set(broker 3: 109, broker 2: 109, broker 1: 109), awaiting Set() (kafka.cluster.Partition)
[2025-10-16 15:57:13,301] TRACE [Partition performance-test-2 broker=1] Skipping update high watermark since new hw (offset=109, segment=[16:99668]) is not larger than old value. All current LEOs are Set(replica 2: (offset=109, segment=[16:99668]), replica 3: (offset=109, segment=[16:99668]), replica 1: (offset=110, segment=[16:100762])) (kafka.cluster.Partition)
[2025-10-16 15:57:13,301] TRACE [Partition performance-test-2 broker=1] Progress awaiting ISR acks for offset 110: acked: Set(broker 1: 110), awaiting Set(broker 3: 109, broker 2: 109) (kafka.cluster.Partition)
[2025-10-16 15:57:13,301] TRACE [Partition performance-test-2 broker=1] Progress awaiting ISR acks for offset 110: acked: Set(broker 1: 110), awaiting Set(broker 3: 109, broker 2: 109) (kafka.cluster.Partition)
[2025-10-16 15:57:13,302] TRACE [Partition performance-test-2 broker=1] Skipping update high watermark since new hw (offset=109, segment=[16:99668]) is not larger than old value. All current LEOs are Set(replica 2: (offset=110, segment=[16:100762]), replica 3: (offset=109, segment=[16:99668]), replica 1: (offset=110, segment=[16:100762])) (kafka.cluster.Partition)
[2025-10-16 15:57:13,303] DEBUG [Partition performance-test-2 broker=1] High watermark updated from (offset=109, segment=[16:99668]) to (offset=110, segment=[16:100762]) (kafka.cluster.Partition)
[2025-10-16 15:57:13,303] TRACE [Partition performance-test-2 broker=1] Progress awaiting ISR acks for offset 110: acked: Set(broker 3: 110, broker 2: 110, broker 1: 110), awaiting Set() (kafka.cluster.Partition)
[2025-10-16 15:57:13,317] TRACE [Partition performance-test-2 broker=1] Skipping update high watermark since new hw (offset=110, segment=[16:100762]) is not larger than old value. All current LEOs are Set(replica 2: (offset=110, segment=[16:100762]), replica 3: (offset=110, segment=[16:100762]), replica 1: (offset=111, segment=[16:101856])) (kafka.cluster.Partition)
[2025-10-16 15:57:13,318] TRACE [Partition performance-test-2 broker=1] Progress awaiting ISR acks for offset 111: acked: Set(broker 1: 111), awaiting Set(broker 3: 110, broker 2: 110) (kafka.cluster.Partition)
[2025-10-16 15:57:13,318] TRACE [Partition performance-test-2 broker=1] Progress awaiting ISR acks for offset 111: acked: Set(broker 1: 111), awaiting Set(broker 3: 110, broker 2: 110) (kafka.cluster.Partition)
[2025-10-16 15:57:13,319] TRACE [Partition performance-test-2 broker=1] Skipping update high watermark since new hw (offset=110, segment=[16:100762]) is not larger than old value. All current LEOs are Set(replica 2: (offset=110, segment=[16:100762]), replica 3: (offset=111, segment=[16:101856]), replica 1: (offset=111, segment=[16:101856])) (kafka.cluster.Partition)
[2025-10-16 15:57:13,319] DEBUG [Partition performance-test-2 broker=1] High watermark updated from (offset=110, segment=[16:100762]) to (offset=111, segment=[16:101856]) (kafka.cluster.Partition)
[2025-10-16 15:57:13,319] TRACE [Partition performance-test-2 broker=1] Progress awaiting ISR acks for offset 111: acked: Set(broker 3: 111, broker 2: 111, broker 1: 111), awaiting Set() (kafka.cluster.Partition)
[2025-10-16 15:57:13,325] TRACE [Partition performance-test-2 broker=1] Skipping update high watermark since new hw (offset=111, segment=[16:101856]) is not larger than old value. All current LEOs are Set(replica 2: (offset=111, segment=[16:101856]), replica 3: (offset=111, segment=[16:101856]), replica 1: (offset=113, segment=[16:103983])) (kafka.cluster.Partition)
[2025-10-16 15:57:13,325] TRACE [Partition performance-test-2 broker=1] Progress awaiting ISR acks for offset 113: acked: Set(broker 1: 113), awaiting Set(broker 3: 111, broker 2: 111) (kafka.cluster.Partition)
[2025-10-16 15:57:13,325] TRACE [Partition performance-test-2 broker=1] Progress awaiting ISR acks for offset 113: acked: Set(broker 1: 113), awaiting Set(broker 3: 111, broker 2: 111) (kafka.cluster.Partition)
[2025-10-16 15:57:13,326] TRACE [Partition performance-test-2 broker=1] Skipping update high watermark since new hw (offset=111, segment=[16:101856]) is not larger than old value. All current LEOs are Set(replica 2: (offset=113, segment=[16:103983]), replica 3: (offset=111, segment=[16:101856]), replica 1: (offset=113, segment=[16:103983])) (kafka.cluster.Partition)
[2025-10-16 15:57:13,326] DEBUG [Partition performance-test-2 broker=1] High watermark updated from (offset=111, segment=[16:101856]) to (offset=113, segment=[16:103983]) (kafka.cluster.Partition)
[2025-10-16 15:57:13,326] TRACE [Partition performance-test-2 broker=1] Progress awaiting ISR acks for offset 113: acked: Set(broker 3: 113, broker 2: 113, broker 1: 113), awaiting Set() (kafka.cluster.Partition)
[2025-10-16 15:57:13,340] TRACE [Partition performance-test-2 broker=1] Skipping update high watermark since new hw (offset=113, segment=[16:103983]) is not larger than old value. All current LEOs are Set(replica 2: (offset=113, segment=[16:103983]), replica 3: (offset=113, segment=[16:103983]), replica 1: (offset=114, segment=[16:105077])) (kafka.cluster.Partition)
[2025-10-16 15:57:13,340] TRACE [Partition performance-test-2 broker=1] Progress awaiting ISR acks for offset 114: acked: Set(broker 1: 114), awaiting Set(broker 3: 113, broker 2: 113) (kafka.cluster.Partition)
[2025-10-16 15:57:13,340] TRACE [Partition performance-test-2 broker=1] Progress awaiting ISR acks for offset 114: acked: Set(broker 1: 114), awaiting Set(broker 3: 113, broker 2: 113) (kafka.cluster.Partition)
[2025-10-16 15:57:13,341] DEBUG [Partition performance-test-2 broker=1] High watermark updated from (offset=113, segment=[16:103983]) to (offset=114, segment=[16:105077]) (kafka.cluster.Partition)
[2025-10-16 15:57:13,341] TRACE [Partition performance-test-2 broker=1] Skipping update high watermark since new hw (offset=113, segment=[16:103983]) is not larger than old value. All current LEOs are Set(replica 2: (offset=114, segment=[16:105077]), replica 3: (offset=114, segment=[16:105077]), replica 1: (offset=114, segment=[16:105077])) (kafka.cluster.Partition)
[2025-10-16 15:57:13,341] TRACE [Partition performance-test-2 broker=1] Progress awaiting ISR acks for offset 114: acked: Set(broker 3: 114, broker 2: 114, broker 1: 114), awaiting Set() (kafka.cluster.Partition)
[2025-10-16 15:57:13,350] TRACE [Partition performance-test-2 broker=1] Skipping update high watermark since new hw (offset=114, segment=[16:105077]) is not larger than old value. All current LEOs are Set(replica 2: (offset=114, segment=[16:105077]), replica 3: (offset=114, segment=[16:105077]), replica 1: (offset=115, segment=[16:106171])) (kafka.cluster.Partition)
[2025-10-16 15:57:13,350] TRACE [Partition performance-test-2 broker=1] Progress awaiting ISR acks for offset 115: acked: Set(broker 1: 115), awaiting Set(broker 3: 114, broker 2: 114) (kafka.cluster.Partition)
[2025-10-16 15:57:13,350] TRACE [Partition performance-test-2 broker=1] Progress awaiting ISR acks for offset 115: acked: Set(broker 1: 115), awaiting Set(broker 3: 114, broker 2: 114) (kafka.cluster.Partition)
[2025-10-16 15:57:13,351] TRACE [Partition performance-test-2 broker=1] Skipping update high watermark since new hw (offset=114, segment=[16:105077]) is not larger than old value. All current LEOs are Set(replica 2: (offset=115, segment=[16:106171]), replica 3: (offset=114, segment=[16:105077]), replica 1: (offset=115, segment=[16:106171])) (kafka.cluster.Partition)
[2025-10-16 15:57:13,351] DEBUG [Partition performance-test-2 broker=1] High watermark updated from (offset=114, segment=[16:105077]) to (offset=115, segment=[16:106171]) (kafka.cluster.Partition)
[2025-10-16 15:57:13,351] TRACE [Partition performance-test-2 broker=1] Progress awaiting ISR acks for offset 115: acked: Set(broker 3: 115, broker 2: 115, broker 1: 115), awaiting Set() (kafka.cluster.Partition)
[2025-10-16 15:57:13,362] TRACE [Partition performance-test-2 broker=1] Skipping update high watermark since new hw (offset=115, segment=[16:106171]) is not larger than old value. All current LEOs are Set(replica 2: (offset=115, segment=[16:106171]), replica 3: (offset=115, segment=[16:106171]), replica 1: (offset=116, segment=[16:107265])) (kafka.cluster.Partition)
[2025-10-16 15:57:13,362] TRACE [Partition performance-test-2 broker=1] Progress awaiting ISR acks for offset 116: acked: Set(broker 1: 116), awaiting Set(broker 3: 115, broker 2: 115) (kafka.cluster.Partition)
[2025-10-16 15:57:13,362] TRACE [Partition performance-test-2 broker=1] Progress awaiting ISR acks for offset 116: acked: Set(broker 1: 116), awaiting Set(broker 3: 115, broker 2: 115) (kafka.cluster.Partition)
[2025-10-16 15:57:13,364] TRACE [Partition performance-test-2 broker=1] Skipping update high watermark since new hw (offset=115, segment=[16:106171]) is not larger than old value. All current LEOs are Set(replica 2: (offset=115, segment=[16:106171]), replica 3: (offset=116, segment=[16:107265]), replica 1: (offset=116, segment=[16:107265])) (kafka.cluster.Partition)
[2025-10-16 15:57:13,364] DEBUG [Partition performance-test-2 broker=1] High watermark updated from (offset=115, segment=[16:106171]) to (offset=116, segment=[16:107265]) (kafka.cluster.Partition)
[2025-10-16 15:57:13,364] TRACE [Partition performance-test-2 broker=1] Progress awaiting ISR acks for offset 116: acked: Set(broker 3: 116, broker 2: 116, broker 1: 116), awaiting Set() (kafka.cluster.Partition)
[2025-10-16 15:57:13,375] TRACE [Partition performance-test-2 broker=1] Skipping update high watermark since new hw (offset=116, segment=[16:107265]) is not larger than old value. All current LEOs are Set(replica 2: (offset=116, segment=[16:107265]), replica 3: (offset=116, segment=[16:107265]), replica 1: (offset=117, segment=[16:108359])) (kafka.cluster.Partition)
[2025-10-16 15:57:13,375] TRACE [Partition performance-test-2 broker=1] Progress awaiting ISR acks for offset 117: acked: Set(broker 1: 117), awaiting Set(broker 3: 116, broker 2: 116) (kafka.cluster.Partition)
[2025-10-16 15:57:13,375] TRACE [Partition performance-test-2 broker=1] Progress awaiting ISR acks for offset 117: acked: Set(broker 1: 117), awaiting Set(broker 3: 116, broker 2: 116) (kafka.cluster.Partition)
[2025-10-16 15:57:13,376] TRACE [Partition performance-test-2 broker=1] Skipping update high watermark since new hw (offset=116, segment=[16:107265]) is not larger than old value. All current LEOs are Set(replica 2: (offset=116, segment=[16:107265]), replica 3: (offset=117, segment=[16:108359]), replica 1: (offset=117, segment=[16:108359])) (kafka.cluster.Partition)
[2025-10-16 15:57:13,376] DEBUG [Partition performance-test-2 broker=1] High watermark updated from (offset=116, segment=[16:107265]) to (offset=117, segment=[16:108359]) (kafka.cluster.Partition)
[2025-10-16 15:57:13,376] TRACE [Partition performance-test-2 broker=1] Progress awaiting ISR acks for offset 117: acked: Set(broker 3: 117, broker 2: 117, broker 1: 117), awaiting Set() (kafka.cluster.Partition)
[2025-10-16 15:57:13,387] TRACE [Partition performance-test-2 broker=1] Skipping update high watermark since new hw (offset=117, segment=[16:108359]) is not larger than old value. All current LEOs are Set(replica 2: (offset=117, segment=[16:108359]), replica 3: (offset=117, segment=[16:108359]), replica 1: (offset=119, segment=[16:110486])) (kafka.cluster.Partition)
[2025-10-16 15:57:13,387] TRACE [Partition performance-test-2 broker=1] Progress awaiting ISR acks for offset 119: acked: Set(broker 1: 119), awaiting Set(broker 3: 117, broker 2: 117) (kafka.cluster.Partition)
[2025-10-16 15:57:13,387] TRACE [Partition performance-test-2 broker=1] Progress awaiting ISR acks for offset 119: acked: Set(broker 1: 119), awaiting Set(broker 3: 117, broker 2: 117) (kafka.cluster.Partition)
[2025-10-16 15:57:13,389] TRACE [Partition performance-test-2 broker=1] Skipping update high watermark since new hw (offset=117, segment=[16:108359]) is not larger than old value. All current LEOs are Set(replica 2: (offset=119, segment=[16:110486]), replica 3: (offset=119, segment=[16:110486]), replica 1: (offset=119, segment=[16:110486])) (kafka.cluster.Partition)
[2025-10-16 15:57:13,389] DEBUG [Partition performance-test-2 broker=1] High watermark updated from (offset=117, segment=[16:108359]) to (offset=119, segment=[16:110486]) (kafka.cluster.Partition)
[2025-10-16 15:57:13,389] TRACE [Partition performance-test-2 broker=1] Progress awaiting ISR acks for offset 119: acked: Set(broker 3: 119, broker 2: 119, broker 1: 119), awaiting Set() (kafka.cluster.Partition)
[2025-10-16 15:57:13,400] TRACE [Partition performance-test-2 broker=1] Skipping update high watermark since new hw (offset=119, segment=[16:110486]) is not larger than old value. All current LEOs are Set(replica 2: (offset=119, segment=[16:110486]), replica 3: (offset=119, segment=[16:110486]), replica 1: (offset=120, segment=[16:111580])) (kafka.cluster.Partition)
[2025-10-16 15:57:13,400] TRACE [Partition performance-test-2 broker=1] Progress awaiting ISR acks for offset 120: acked: Set(broker 1: 120), awaiting Set(broker 3: 119, broker 2: 119) (kafka.cluster.Partition)
[2025-10-16 15:57:13,400] TRACE [Partition performance-test-2 broker=1] Progress awaiting ISR acks for offset 120: acked: Set(broker 1: 120), awaiting Set(broker 3: 119, broker 2: 119) (kafka.cluster.Partition)
[2025-10-16 15:57:13,401] TRACE [Partition performance-test-2 broker=1] Skipping update high watermark since new hw (offset=119, segment=[16:110486]) is not larger than old value. All current LEOs are Set(replica 2: (offset=120, segment=[16:111580]), replica 3: (offset=119, segment=[16:110486]), replica 1: (offset=120, segment=[16:111580])) (kafka.cluster.Partition)
[2025-10-16 15:57:13,401] DEBUG [Partition performance-test-2 broker=1] High watermark updated from (offset=119, segment=[16:110486]) to (offset=120, segment=[16:111580]) (kafka.cluster.Partition)
[2025-10-16 15:57:13,401] TRACE [Partition performance-test-2 broker=1] Progress awaiting ISR acks for offset 120: acked: Set(broker 3: 120, broker 2: 120, broker 1: 120), awaiting Set() (kafka.cluster.Partition)
[2025-10-16 15:57:13,413] TRACE [Partition performance-test-2 broker=1] Skipping update high watermark since new hw (offset=120, segment=[16:111580]) is not larger than old value. All current LEOs are Set(replica 2: (offset=120, segment=[16:111580]), replica 3: (offset=120, segment=[16:111580]), replica 1: (offset=121, segment=[16:112674])) (kafka.cluster.Partition)
[2025-10-16 15:57:13,413] TRACE [Partition performance-test-2 broker=1] Progress awaiting ISR acks for offset 121: acked: Set(broker 1: 121), awaiting Set(broker 3: 120, broker 2: 120) (kafka.cluster.Partition)
[2025-10-16 15:57:13,413] TRACE [Partition performance-test-2 broker=1] Progress awaiting ISR acks for offset 121: acked: Set(broker 1: 121), awaiting Set(broker 3: 120, broker 2: 120) (kafka.cluster.Partition)
[2025-10-16 15:57:13,414] TRACE [Partition performance-test-2 broker=1] Skipping update high watermark since new hw (offset=120, segment=[16:111580]) is not larger than old value. All current LEOs are Set(replica 2: (offset=121, segment=[16:112674]), replica 3: (offset=120, segment=[16:111580]), replica 1: (offset=121, segment=[16:112674])) (kafka.cluster.Partition)
[2025-10-16 15:57:13,414] DEBUG [Partition performance-test-2 broker=1] High watermark updated from (offset=120, segment=[16:111580]) to (offset=121, segment=[16:112674]) (kafka.cluster.Partition)
[2025-10-16 15:57:13,414] TRACE [Partition performance-test-2 broker=1] Progress awaiting ISR acks for offset 121: acked: Set(broker 3: 121, broker 2: 121, broker 1: 121), awaiting Set() (kafka.cluster.Partition)
...
```

**Understanding the Log Format:**

Kafka with (3/4.x+) includes additional metadata in logs, Segment metadata** (f.e., `(offset=89, segment=[16:78032])`) shows which log segment contains the offset and also
granular ISR tracking such as, `"Progress awaiting ISR acks"` shows exactly which brokers have acknowledged.

**Runtime Verification Result - The Replication Flow:**

Following a typical message through the system (e.g., offset 89):

1. **Leader appends** to local log (LEO = 89)
   - Only broker 1 has the new offset
   - HW remains at 88 (cannot advance yet)
   - Log: `Progress awaiting ISR acks for offset 89: acked: Set(broker 1: 89), awaiting Set(broker 3: 88, broker 2: 88)`

2. **First follower replicates** (broker 2 fetches)
   - Broker 2's LEO advances to 89
   - ISR state: {1: LEO=89, 2: LEO=89, 3: LEO=88}
   - HW still cannot advance (waiting for broker 3)
   - Log: `Skipping update high watermark since new hw (offset=88...) is not larger than old value`

3. **Second follower replicates** (broker 3 fetches)
   - Broker 3's LEO advances to 89
   - ISR state: {1: LEO=89, 2: LEO=89, 3: LEO=89}
   - **HW can now advance**: HW = min(all ISR LEOs) = 89
   - Log: `High watermark updated from (offset=88...) to (offset=89...)`

4. **Producer acknowledgment**
   - Log: `Progress awaiting ISR acks for offset 89: acked: Set(broker 3: 89, broker 2: 89, broker 1: 89), awaiting Set()`
   - Producer's `acks=all` request completes

This confirms the HW advancement logic from `Partition.scala:1159` (i.e., `maybeIncrementLeaderHW`), demonstrating that:
- HW only advances when `min(ISR LEOs) > current HW`
- With `acks=all`, producers wait for all ISR members to acknowledge
- The protocol provides strong durability guarantees (messages committed to HW are durable)

### Test 3: Verifying MinISR Enforcement

**Scenario:** Stop 2 brokers (leaving only 1) and verify writes are rejected with `min.insync.replicas=2`.

**Step 1: Stop Brokers 2 and 3**
```bash
# Stop both brokers
```

**Step 2: Check Partition Status**
```bash
kafka-topics --describe --topic performance-test --bootstrap-server localhost:9092
```

**Output:**
```
Topic: performance-test TopicId: AMNt6PcpRZOktSh6v-u00A PartitionCount: 3       ReplicationFactor: 3    Configs: min.insync.replicas=2,cleanup.policy=delete,segment.bytes=1073741824
        Topic: performance-test Partition: 0    Leader: 1       Replicas: 2,3,1 Isr: 1  Elr: 3  LastKnownElr:
        Topic: performance-test Partition: 1    Leader: 1       Replicas: 3,1,2 Isr: 1  Elr: 3  LastKnownElr:
        Topic: performance-test Partition: 2    Leader: 1       Replicas: 1,2,3 Isr: 1  Elr: 3  LastKnownElr:
```

**Step 3: Try to Produce**
```bash
echo "test" | kafka-console-producer \
  --topic performance-test \
  --bootstrap-server localhost:9092 \
  --property acks=all
```

**Error Output:**
```
[2025-10-16 16:07:20,903] WARN [Producer clientId=console-producer] Got error produce response with correlation id 5 on topic-partition performance-test-0, retrying (2 attempts left). Error: NOT_ENOUGH_REPLICAS (org.apache.kafka.clients.producer.internals.Sender)
[2025-10-16 16:07:21,018] WARN [Producer clientId=console-producer] Got error produce response with correlation id 6 on topic-partition performance-test-0, retrying (1 attempts left). Error: NOT_ENOUGH_REPLICAS (org.apache.kafka.clients.producer.internals.Sender)
[2025-10-16 16:07:21,247] WARN [Producer clientId=console-producer] Got error produce response with correlation id 7 on topic-partition performance-test-0, retrying (0 attempts left). Error: NOT_ENOUGH_REPLICAS (org.apache.kafka.clients.producer.internals.Sender)
[2025-10-16 16:07:21,659] ERROR Error when sending message to topic performance-test with key: null, value: 4 bytes with error: (org.apache.kafka.clients.producer.internals.ErrorLoggingCallback)
org.apache.kafka.common.errors.NotEnoughReplicasException: Messages are rejected since there are fewer in-sync replicas than required.
```

**Step 4: Check Broker Logs**

In Broker 1's log:
```
[2025-10-16 16:07:21,017] ERROR [ReplicaManager broker=1] Error processing append operation on partition AMNt6PcpRZOktSh6v-u00A:performance-test-0 (kafka.server.Replica
Manager)
org.apache.kafka.common.errors.NotEnoughReplicasException: The size of the current ISR : 1 is insufficient to satisfy the min.isr requirement of 2 for partition perform
ance-test-0, live replica(s) broker.id are : Set(1)
```

**Runtime Verification Result:** With `min.insync.replicas=2` and only 1 broker in ISR, writes are correctly rejected. This confirms the minISR check from `Partition.scala:1532`.

### Test 4: Measuring Replication Lag (optional) => PLEASE USE DOCKER/PODMAN for such test case.

**Scenario:** Induce network delay and measure replication lag. 

For this scenario, you should run this scenario within Docker. 
On macOS there is no possibility to run `tc` utility.

**Step 1: Add Network Delay (macOS/Linux)**
```bash
# Simulate 100ms delay to broker 3
sudo tc qdisc add dev lo0 root netem delay 100ms

# Or on Linux:
# sudo tc qdisc add dev lo root netem delay 100ms
```

**Step 2: Produce Load**
```bash
kafka-producer-perf-test \
  --topic performance-test \
  --num-records 100000 \
  --record-size 1024 \
  --throughput 10000 \
  --producer-props bootstrap.servers=localhost:9092 acks=all
```

**Step 3: Check ISR Status During Load**
```bash
watch -n 2 'kafka-topics --describe --topic performance-test --bootstrap-server localhost:9092'
```

**Observation:**
- With 100ms network delay, lag increases to ~3000 messages
- If lag persists beyond `replica.lag.time.max.ms` (10s), replica is removed from ISR
- After removing network delay, replica catches up and rejoins ISR

**Step 5: Remove Network Delay**
```bash
sudo tc qdisc del dev lo0 root
```

## Automated Log Verification Script

Let's create a script to automatically verify replication protocol invariants from logs.
Based on our runtime testing, we've adapted this script to work with Kafka 4.x+ log formats:

**verify-replication-invariants.sh:**
```bash
#!/bin/bash

LOG_FILE="$1"

if [ -z "$LOG_FILE" ]; then
  echo "Usage: $0 <broker-log-file>"
  exit 1
fi

echo "=== Kafka Replication Protocol Verification ==="
echo "Analyzing: $LOG_FILE"
echo

# Invariant 1: HW never decreases
# Note: Kafka 4.x uses format "offset=X, segment=[Y:Z]" instead of simple offsets
echo "[Invariant 1] High Watermark Monotonicity"
grep "High watermark updated" "$LOG_FILE" | \
  awk '{
    # Match both old format: "from 10 to 20" and new format: "from (offset=10, segment=...) to (offset=20, segment=...)"
    if (match($0, /from \(offset=([0-9]+),.*to \(offset=([0-9]+),/, arr)) {
      from = arr[1]
      to = arr[2]
    } else if (match($0, /from ([0-9]+) to ([0-9]+)/, arr)) {
      from = arr[1]
      to = arr[2]
    } else {
      next
    }

    if (to < from) {
      print "VIOLATION: HW decreased from " from " to " to
      print "  Line: " $0
      violations++
    }
    count++
  }
  END {
    if (violations > 0) {
      print "FAILED: " violations " violations found in " count " HW updates"
      exit 1
    } else if (count > 0) {
      print "PASSED: HW never decreased across " count " updates"
    } else {
      print "SKIPPED: No HW updates found (enable DEBUG logging for kafka.cluster.Partition)"
    }
  }'

echo

# Invariant 2: ISR changes are logged and versioned
# Note: Kafka 4.x uses "ISR updated to X,Y,Z and version updated to N"
echo "[Invariant 2] ISR Change Protocol Verification"
isr_changes=$(grep -c "ISR updated to" "$LOG_FILE")
if [ "$isr_changes" -gt 0 ]; then
  echo "Found $isr_changes ISR updates"

  # Verify ISR changes include version updates (fencing mechanism)
  versioned=$(grep "ISR updated to" "$LOG_FILE" | grep -c "version updated to")

  if [ "$versioned" -eq "$isr_changes" ]; then
    echo "PASSED: All $isr_changes ISR changes include version updates (partition epoch fencing)"
  else
    echo "WARNING: $((isr_changes - versioned)) ISR changes without version updates"
  fi
else
  echo "SKIPPED: No ISR changes found (topic may be stable or logs incomplete)"
fi

echo

# Invariant 3: Partition version increases monotonically
echo "[Invariant 3] Partition Version Monotonicity"
grep "ISR updated to" "$LOG_FILE" | \
  awk '{
    if (match($0, /version updated to ([0-9]+)/, arr)) {
      version = arr[1]
      partition = $0

      # Extract partition name for per-partition tracking
      if (match($0, /Partition ([^ ]+) broker/, arr2)) {
        part_name = arr2[1]
      } else {
        part_name = "unknown"
      }

      # Check monotonicity per partition
      if (last_version[part_name] != "" && version <= last_version[part_name]) {
        print "VIOLATION: Partition " part_name " version did not increase: " last_version[part_name] " -> " version
        violations++
      }
      last_version[part_name] = version
      count++
    }
  }
  END {
    if (violations > 0) {
      print "FAILED: " violations " violations in " count " version updates"
      exit 1
    } else if (count > 0) {
      print "PASSED: Partition versions monotonically increased across " count " updates"
    } else {
      print "SKIPPED: No partition version updates found"
    }
  }'

echo

# Invariant 4: MinISR enforcement
# Note: Kafka 4.x uses "The size of the current ISR : X is insufficient to satisfy the min.isr requirement of Y"
echo "[Invariant 4] Min ISR Enforcement"
grep -i "NotEnoughReplicasException" "$LOG_FILE" | \
  awk '{
    if (match($0, /size of the current ISR : ([0-9]+) is insufficient to satisfy the min\.isr requirement of ([0-9]+)/, arr)) {
      isr_size = arr[1]
      min_isr = arr[2]

      if (isr_size >= min_isr) {
        print "VIOLATION: Exception thrown when ISR size " isr_size " >= min ISR " min_isr
        print "  Line: " $0
        violations++
      }
      count++
    }
  }
  END {
    if (violations > 0) {
      print "FAILED: " violations " violations in " count " MinISR checks"
      exit 1
    } else if (count > 0) {
      print "PASSED: MinISR correctly enforced across " count " rejections"
    } else {
      print "SKIPPED: No MinISR violations found (cluster may be healthy)"
    }
  }'

echo

# Invariant 5: ISR acknowledgment completeness (acks=all verification)
echo "[Invariant 5] ISR Acknowledgment Completeness"
ack_patterns=$(grep -c "Progress awaiting ISR acks.*awaiting Set()" "$LOG_FILE")
if [ "$ack_patterns" -gt 0 ]; then
  echo "PASSED: Found $ack_patterns complete ISR acknowledgments (all replicas acked)"
  echo "        This verifies acks=all protocol is working correctly"
else
  echo "SKIPPED: No ISR ack traces found (enable TRACE logging for kafka.cluster.Partition)"
fi

echo
echo "=== Verification Complete ==="
echo
echo "Tip: For comprehensive verification, enable these log levels:"
echo "  kafka-configs --bootstrap-server localhost:9092 --alter \\"
echo "    --entity-type broker-loggers --entity-name <broker-id> \\"
echo "    --add-config kafka.cluster.Partition=TRACE,kafka.server.ReplicaManager=DEBUG"
```

**Usage:**
```bash
chmod +x verify-replication-invariants.sh
./verify-replication-invariants.sh /tmp/kafka-logs-1/server.log
```

Basically, you have to send records by producer. 
That would trigger `Invariant 1` and also `Invariant 5.`
Others i.e., `2 and 3` would be triggered by removing one of the follower nodes and then immediately starting them, which would trigger ISR shrinking.
The last one would be triggerd by removing at least 2 brokers.

**Example output:**

```bash
=== Kafka Replication Protocol Verification ===
Analyzing: /tmp/kafka-logs-3/server.log

[Invariant 1] High Watermark Monotonicity
PASSED: HW never decreased across 3 updates

[Invariant 2] ISR Change Protocol Verification
Found 23 ISR updates
PASSED: All 23 ISR changes include version updates (partition epoch fencing)

[Invariant 3] Partition Version Monotonicity
PASSED: Partition versions monotonically increased across 23 updates

[Invariant 4] Min ISR Enforcement
SKIPPED: No MinISR violations found (cluster may be healthy)

[Invariant 5] ISR Acknowledgment Completeness
PASSED: Found 3 complete ISR acknowledgments (all replicas acked)
        This verifies acks=all protocol is working correctly

=== Verification Complete ===

Tip: For comprehensive verification, enable these log levels:
  kafka-configs --bootstrap-server localhost:<kafka-port> --alter \
    --entity-type broker-loggers --entity-name <broker-id> \
    --add-config kafka.cluster.Partition=TRACE,kafka.server.ReplicaManager=DEBUG
```


## Failure Scenario Testing

### Test 5: Leader Failover

**Scenario:** Kill the leader and verify automatic failover.

**Step 1: Identify Leader for Partition 0**
```bash
kafka-topics --describe --topic performance-test --bootstrap-server localhost:9092 | grep "Partition: 0"
```

Output: `Leader: 1` (but may very, you should again check it via quorum shell script!)

**Step 2: Kill Broker 1**
```bash
# In broker 1's terminal, kill the process
kill -9 <broker-1-pid>
```

**Step 3: Check New Leader**
```bash
kafka-topics --describe --topic performance-test --bootstrap-server localhost:19092 | grep "Partition: 0"
```
**Observation:** Leader failed over from broker 1 to broker 2 within ~5 seconds.

**Step 4: Verify Continued Availability**
```bash
echo "test-after-failover" | kafka-console-producer \
  --topic performance-test \
  --bootstrap-server localhost:19092 \
  --property acks=all
```

**Result:** Produce succeeds, confirming availability maintained.

**Step 5: Restart Broker 1 and Verify Rejoin**
```bash
kafka-server-start config/kraft/server-1.properties &
sleep 10
kafka-topics --describe --topic performance-test --bootstrap-server localhost:9092 | grep "Partition: 0"
```

Broker 1 rejoined ISR as a follower.

## Key Findings

### Runtime Verification Findings

Through log analysis, we verified:

1. **High Watermark Invariant:** HW never decreased (monotonic)
2. **ISR Protocol:** All ISR changes went through AlterPartition (transactional)
3. **MinISR Enforcement:** Writes correctly rejected when `ISR size < min.insync.replicas`
4. **Partition Epochs:** Epochs increased monotonically (no stale metadata)
5. **Leader Election:** Failover occurred within 5 seconds with zero message loss

These runtime observations match the theoretical guarantees described in the [replication protocol post](/posts/kafka-internals-replication-protocol).

## Summary

In this practical guide, we:

1. Built a 3-broker KRaft cluster from scratch
2. Conducted systematic performance tests measuring throughput and latency
3. Used runtime log analysis to verify replication protocol correctness
4. Tested failure scenarios (leader failover, ISR changes, minISR enforcement)
5. Automated invariant checking via log parsing scripts
6. Derived optimized configurations for different workload profiles

Combining empirical performance testing with runtime verification provides high confidence that Kafka's implementation matches its theoretical guarantees. 
The logs reveal exactly how the replication protocol works in practice, confirming behaviors like ISR management, HW advancement, and AlterPartition protocol.

## Next Steps

In the next post, we'll explore **consumer groups and coordination protocol**, building on this foundation to understand how Kafka manages distributed consumption and partition assignment.

---

*All tests conducted on Kafka 4.1.0. Your mileage may vary based on hardware.*