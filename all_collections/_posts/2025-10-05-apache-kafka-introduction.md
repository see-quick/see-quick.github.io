---
layout: post
title: "Apache Kafka: WHAT, WHY, and HOW"
date: 2025-10-05
categories: ["kafka", "distributed-systems"]
---

Apache Kafka has become the de facto standard for event streaming in modern distributed systems. 
But what exactly is it, why has it become so popular, and how does it work? Let's explore.

## WHAT is Apache Kafka?

Apache Kafka is a **distributed event streaming platform** originally developed at LinkedIn and open-sourced in 2011. At its core, Kafka is:

- A **distributed commit log** - append-only, ordered, and durable
- A **pub/sub messaging system** - producers write, consumers read
- A **distributed storage system** - data is replicated and fault-tolerant
- A **stream processing platform** - via Kafka Streams and ksqlDB

Think of Kafka as a distributed, horizontally-scalable message queue that retains all messages for a configurable period (days, weeks, or forever), 
allowing multiple consumers to read the same data independently.

### Core Concepts

| Concept       | Description                                                              |
|---------------|--------------------------------------------------------------------------|
| **Topic**     | A category/feed name to which records are published (like a table)       |
| **Partition** | Topics are split into partitions for parallelism and ordering guarantees |
| **Producer**  | Application that publishes records to topics                             |
| **Consumer**  | Application that subscribes to topics and processes records              |
| **Broker**    | A Kafka server that stores data and serves clients                       |
| **Cluster**   | Multiple brokers working together for redundancy and scale               |

### Simple Example

```
Producer → [Topic: user-events] → Consumer
            ├─ Partition 0: event1, event2, event4...
            ├─ Partition 1: event3, event5, event7...
            └─ Partition 2: event6, event8, event9...
```

Each partition is an ordered, immutable sequence of records. 
Producers append to the end, consumers read from anywhere.

## WHY is Kafka so Popular?

Kafka's popularity stems from solving fundamental challenges in distributed systems:

### 1. **Decoupling at Scale**

Traditional point-to-point integrations create a mesh of dependencies:

```
Service A ──→ Service B
  ├─────────→ Service C
  └─────────→ Service D

Service B ──→ Service C
  └─────────→ Service D
```

With Kafka as a central nervous system:

```
Service A ──┐
Service B ──┼──→ [Kafka] ──┐
Service C ──┘              ├──→ Service D
                           └──→ Service E
```

Services publish events without knowing who consumes them. 
New consumers can be added without changing producers.

### 2. **Replay & Multiple Consumers**

Unlike traditional message queues where messages are deleted after consumption, Kafka retains data. 
This enables:

- **Replay**: Reprocess historical data (e.g., fix a bug, train ML models)
- **Multiple consumers**: Analytics, search indexing, and real-time processing can all read the same stream
- **Late consumers**: New services can bootstrap from historical data

### 3. **High Throughput & Low Latency**

Kafka is designed for millions of messages per second:

- Sequential disk I/O (faster than random access)
- Zero-copy transfers (OS → network without copying to application memory)
- Batch compression
- Horizontal scaling via partitions

Typical latencies: **2-10ms** end-to-end at **millions of messages/sec** per broker.

### 4. **Fault Tolerance & Durability**

- **Replication**: Each partition replicated across N brokers (configurable)
- **Leader election**: Automatic failover if a broker dies
- **Persistence**: All data written to disk, optionally synced
- **No data loss**: Configurable acknowledgment semantics (`acks=all`)

### 5. **Real-World Use Cases**

Kafka powers critical infrastructure at:

| Company        | Use Case                                               |
|----------------|--------------------------------------------------------|
| **LinkedIn**   | Activity tracking, operational metrics                 |
| **Netflix**    | Real-time monitoring, recommendations                  |
| **Uber**       | Trip events, location tracking, surge pricing          |
| **Airbnb**     | Payment processing, booking events, fraud detection    |
| **Cloudflare** | Log aggregation, DDoS detection, 30+ trillion msgs/day |

Common patterns:
- **Event sourcing**: Store state changes as events
- **CQRS**: Separate read/write models
- **CDC**: Capture database changes (via Debezium)
- **Microservices communication**: Async event-driven architecture
- **Stream processing**: Real-time analytics, ETL, alerting

## HOW Does Kafka Work?

Let's understand Kafka's architecture and key mechanisms.

### Architecture Overview

```
┌─────────────────────────────────────────┐
│           Kafka Cluster                 │
│  ┌──────────┐  ┌──────────┐  ┌────────┐ │
│  │ Broker 1 │  │ Broker 2 │  │Broker 3│ │
│  │  Leader  │  │ Follower │  │Follower│ │
│  │ Part. 0  │  │ Part. 0  │  │Part. 0 │ │
│  └──────────┘  └──────────┘  └────────┘ │
└─────────────────────────────────────────┘
         ↑                    ↓
    Producers            Consumers
    (write)              (read)
```

### Write Path (Producer)

1. **Producer** sends record with key to topic
2. **Partitioner** determines partition (hash(key) % num_partitions)
3. **Leader broker** for that partition receives the record
4. Record appended to the **commit log** on disk
5. **Followers** replicate the record
6. Leader sends **acknowledgment** to producer (based on `acks` setting)

**Ordering guarantee**: Records within a partition are strictly ordered.

### Read Path (Consumer)

1. **Consumer** subscribes to topic(s)
2. **Consumer group coordinator** assigns partitions to consumers
3. Consumer fetches records from partition leaders starting at **offset**
4. Consumer processes records and **commits offset** (auto or manual)
5. On restart, consumer resumes from last committed offset

**Consumer groups**: Multiple consumers in a group share partitions (scale reads). Different groups independently consume the same data.

### Storage Model

```
Topic: user-events, Partition: 0

Disk: [msg0][msg1][msg2][msg3][msg4]...
       ↑                           ↑
     offset 0                  offset 4

Consumer A: reading at offset 2
Consumer B: reading at offset 4
```

- Each message assigned an **offset** (unique ID within partition)
- Messages are **immutable** - never updated or deleted by consumers
- Retention: time-based (e.g., 7 days) or size-based (e.g., 100GB)
- Consumers track their own position (offset)

### Replication

```
Partition 0:
  Leader:    Broker 1 [msg0, msg1, msg2, msg3] ← producers write here
  Follower:  Broker 2 [msg0, msg1, msg2, msg3] ← replicates from leader
  Follower:  Broker 3 [msg0, msg1, msg2, msg3] ← replicates from leader
```

- **ISR (In-Sync Replicas)**: Followers caught up with leader
- `acks=1`: Leader acknowledges immediately (fast, less durable)
- `acks=all`: Wait for all ISR to replicate (slower, no data loss)
- If leader fails, a follower from ISR becomes new leader

### Partitioning Strategy

Partitions enable:

- **Parallelism**: Each consumer in a group reads different partitions
- **Ordering**: Guaranteed only within a partition
- **Scalability**: Distribute load across brokers

**Key-based partitioning**:
```
Record(key="user123", value="clicked") → hash("user123") % 3 = Partition 1
```
All events for `user123` go to same partition → **ordered processing** for that user.

### Performance Secrets

1. **Sequential writes**: Append-only log → disk sequential writes (600MB/s+ on HDD)
2. **Zero-copy**: `sendfile()` syscall transfers data directly from disk to network
3. **Batching**: Producers/consumers send/fetch records in batches
4. **Compression**: Snappy, LZ4, Zstd - batch compressed for network efficiency
5. **Page cache**: OS caches recent data in RAM → reads often served from memory

## The Kafka Guarantee Model

Kafka provides configurable guarantees:

| Delivery Semantics  | Configuration                                    | Risk                      |
|---------------------|--------------------------------------------------|---------------------------|
| **At-most-once**    | `acks=0`, auto-commit                            | Data loss                 |
| **At-least-once**   | `acks=all`, manual commit after processing       | Duplicates                |
| **Exactly-once**    | Idempotent producer + transactions               | Complex, slight overhead  |

Most production systems use **at-least-once** with idempotent consumers (dedupe on consumer side).

## When NOT to Use Kafka

Kafka isn't always the right choice:

- **Low-latency request-response** (< 1ms) - use RPC instead
- **Small scale** (< 1000 msgs/sec) - simpler queues like RabbitMQ may suffice
- **Complex routing** - use message brokers with advanced routing (RabbitMQ, ActiveMQ)
- **Ephemeral messages** - if you don't need retention, simpler pub/sub works
- **No ordering requirements** - cloud queues (SQS, Pub/Sub) are easier to manage

## Getting Started

**Quick local setup with Docker**:

```bash
docker run -d \
  --name kafka \
  -p 9092:9092 \
  apache/kafka:latest
```

**Produce a message**:

```bash
echo "hello kafka" | ./kafka-console-producer.sh \
  --bootstrap-server localhost:9092 \
  --topic test
```

**Consume messages**:

```bash
./kafka-console-consumer.sh \
  --bootstrap-server localhost:9092 \
  --topic test \
  --from-beginning
```
You should see message: **hello kafka**. 

## Summary

**WHAT**: Kafka is a distributed event streaming platform - a scalable, durable, fault-tolerant commit log.

**WHY**: It solves decoupling, scaling, replay, and durability challenges that traditional systems struggle with. It's the backbone of event-driven architectures.

**HOW**: Through partitioned, replicated append-only logs with producer/consumer APIs, achieving high throughput via sequential I/O, zero-copy, batching, and smart caching.

---

*In the next post, we'll dive deep into Kafka's internal architecture, exploring exactly how brokers process requests, manage replication, and handle failures at the code level.*