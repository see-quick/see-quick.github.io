---
layout: post
title: "26 📜 The History of Messaging Systems: From Telegraph to Event Streaming"
date: 2025-11-01
categories: ["messaging", "distributed-systems", "history"]
---

Messaging systems have been at the heart of distributed computing for decades.
From early mainframe queues to modern event streaming platforms, they've evolved to meet ever-increasing demands for scale, reliability, and real-time processing.
Recently, I have been reading a lot about messaging systems history, so I want to share my findings with you.

## The Dawn of Messaging (1960s-1980s)

### Mainframe Era: The Birth of Message Queuing

**IBM's CICS (Customer Information Control System)** - 1969

IBM CICS introduced transactional messaging for mainframes, allowing programs to communicate asynchronously while maintaining ACID properties (i.e., Atomicity, Consistency, Isolation and Durability).
This was revolutionary for banking and airline reservation systems.

**Key innovations:**
- CICS introduced transactional message delivery, ensuring that messages were processed with ACID guarantees (i.e., if a transaction failed, the message would be rolled back automatically).
- It pioneered queue-based communication between programs, allowing asynchronous processing where one program could send a message and continue working without waiting for a response.
- Most importantly, it enabled decoupling of sender and receiver, meaning applications could communicate without knowing about each other's existence or availability (e.g., a banking application could submit a transaction request even if the processing system was temporarily offline).

### The First Message-Oriented Middleware

**IBM MQSeries (later IBM MQ)** - 1993

IBM MQ was the first commercial Message-Oriented Middleware (MOM) product, standardizing queue-based messaging across platforms.

**Breakthrough features:**
- IBM MQ enabled cross-platform messaging, allowing applications on mainframes, Unix, and Windows to communicate seamlessly (i.e., a COBOL program on an IBM mainframe could send messages to a C++ application running on Unix).
- It provided guaranteed delivery with persistence, meaning messages were written to disk and would survive system crashes or network failures (e.g., if the receiving application was down, messages would wait in the queue until it came back online).
- The system supported both point-to-point and publish-subscribe patterns, giving developers flexibility in how they designed their messaging architecture.
- Finally, it included transaction support, allowing multiple messaging operations to be grouped together and either all succeed or all fail atomically.

```
Application A → [Queue] → Application B
                  ↓
              Persistent
               Storage
```

IBM MQ established patterns that influenced all future messaging systems:
(i.) The Producer/Consumer model separated the roles of message senders and receivers, allowing them to scale independently (e.g., you could have one producer serving ten consumers, or vice versa).
(ii.) Message acknowledgments ensured reliability by requiring consumers to confirm successful processing before messages were removed from the queue (i.e., if a consumer crashed mid-processing, the unacknowledged message would be redelivered).
(iii.) Dead letter queues provided a safety net for problematic messages that couldn't be processed after multiple attempts, preventing them from blocking the main queue (e.g., a malformed message would be moved to the dead letter queue for manual inspection).
(iv.) Finally, clustering for high availability allowed multiple queue managers to work together, ensuring the messaging system remained operational even if individual servers failed.

## The Internet Age (1990s-2000s)

### Java Message Service (JMS) Standard - 1998

Sun Microsystems introduced JMS as a standard Java API for messaging, enabling vendor-neutral messaging code.

**JMS defined two models:**

1. **Point-to-Point (Queue)**
```
Producer → [Queue] → Consumer
```
One message consumed by exactly one consumer.

2. **Publish-Subscribe (Topic)**
```
Publisher → [Topic] → Subscriber A
                   → Subscriber B
                   → Subscriber C
```
One message delivered to all subscribers.

**Major JMS implementations:**
- IBM WebSphere MQ
- Oracle WebLogic Server
- JBoss Messaging
- Apache ActiveMQ (2004)

### The Rise of Open Source Messaging

**Apache ActiveMQ** - 2004

The first widely adopted open-source message broker, ActiveMQ brought enterprise messaging to everyone. 
ActiveMQ provided a full JMS 1.1 implementation, giving developers a complete, standards-compliant messaging API that worked across different vendors and platforms.
It supported multiple protocols including OpenWire, STOMP, and AMQP, allowing clients written in different languages to communicate with the broker (e.g., a Python application using STOMP could exchange messages with a Java application using OpenWire).
The broker included clustering and failover capabilities, ensuring high availability by automatically redirecting clients to healthy brokers when failures occurred.
Finally, it offered a REST API for web integration, making it possible for web applications to send and receive messages directly via HTTP without requiring JMS client libraries (i.e., JavaScript in a browser could publish messages to the queue).

**RabbitMQ** - 2007

Built on the AMQP (Advanced Message Queuing Protocol) standard, RabbitMQ became famous for its reliability and developer-friendly experience.
RabbitMQ offered exceptional routing flexibility through its exchange system, supporting direct routing (messages sent to specific queues), fanout (broadcasting to all queues), topic-based patterns (e.g., `logs.*.error` to match all error logs), and header-based routing for complex message filtering.
Built on Erlang/OTP, the platform inherited legendary reliability from its telecom roots, making it extremely fault-tolerant (i.e., Erlang was designed to keep telephone switches running with 99.9% uptime).
Its rich plugin ecosystem provided everything from management UIs to federation and shovel for moving messages between brokers, plus support for protocols like MQTT for IoT devices.
Finally, RabbitMQ's multiprotocol support (i.e., AMQP, STOMP, MQTT, HTTP) allowed diverse clients to connect regardless of their programming language or platform.

**RabbitMQ routing example:**
```
Producer → [Topic Exchange: "logs"]
            ├─ routing key: "app.error" → Error Queue → Error Handler
            ├─ routing key: "app.info"  → Info Queue  → Logger
            └─ routing key: "app.debug" → Debug Queue → Developer Tools
```

### The Enterprise Service Bus (ESB) Era

**2000s: SOA Hype**

The Service-Oriented Architecture (SOA) movement led to heavyweight ESB products:
- IBM WebSphere ESB
- Oracle Service Bus
- MuleSoft ESB
- WSO2 ESB

ESBs promised to be a centralized integration hub where all enterprise systems could connect and communicate through a single point (i.e., instead of point-to-point integrations growing exponentially, everything would route through the ESB).
They offered message transformation capabilities, automatically converting data formats between systems (e.g., transforming XML from one service to JSON for another).
Protocol translation allowed systems speaking different protocols to communicate seamlessly, while service orchestration enabled complex workflows coordinating multiple services from a central location.

However, ESBs introduced complex deployment and maintenance challenges, requiring specialized skills and significant operational overhead.
They created vendor lock-in as organizations became dependent on proprietary ESB features and configurations that were difficult to migrate away from.
Performance bottlenecks emerged because every message had to flow through the central ESB, creating a single point of congestion.
Most critically, ESBs became a **"God object"** anti-pattern, accumulating too much business logic and becoming a monolithic bottleneck that contradicted the distributed architecture they were meant to enable.

Eventually, many organizations moved away from ESBs back to simpler point-to-point messaging as microservices emerged.

## The Big Data Revolution (2010s)

### Apache Kafka - 2011

**The game-changer.**

LinkedIn open-sourced Kafka to solve a problem traditional message brokers couldn't: handling trillions of events per day with low latency.

**Paradigm shift:**

Traditional message broker:
```
Producer → [Queue in RAM] → Consumer (deletes message)
```
Message deleted after consumption. **Can't replay**.

Kafka:
```
Producer → [Distributed Log on Disk] → Consumer 1 (at offset 100)
                                    → Consumer 2 (at offset 50)
                                    → Consumer 3 (at offset 150)
```
Messages retained for days/weeks. 
Multiple consumers, independent positions. 
Replay anytime.

Kafka introduced the distributed commit log architecture, fundamentally different from traditional queues—messages were stored in an append-only log structure similar to database transaction logs (i.e., writes only append to the end, never modify existing data).
Partitioning enabled horizontal scaling to millions of messages per second by distributing topics across multiple brokers, with each partition being an ordered, immutable sequence of records.
Unlike traditional brokers that deleted messages after consumption, Kafka **retained all data through** configurable retention policies and log compaction (e.g., keeping messages for 7 days or using log compaction to maintain the latest value for each key indefinitely).
The system achieved extreme throughput using zero-copy transfer via the `sendfile()` system call, moving data directly from disk to network without copying through application memory.
Consumer groups allowed multiple consumers to process messages in parallel, with Kafka automatically distributing partitions among group members for load balancing.
Finally, built-in replication provided fault tolerance by maintaining multiple copies of each partition across brokers, without requiring complex consensus protocols like Paxos.

Event sourcing became practical at scale, allowing systems to store every state change as an immutable event that could be replayed to rebuild application state (e.g., a bank could reconstruct account balances by replaying all transaction events).
Stream processing emerged as a first-class paradigm with Kafka Streams in 2016, enabling real-time data transformations and analytics directly on event streams.
Real-time data pipelines replaced traditional batch ETL processes, allowing organizations to process and react to data in milliseconds rather than hours (i.e., fraud detection systems could analyze transactions as they occurred, not overnight).
This foundation enabled event-driven microservices architecture, where services communicated through immutable events rather than direct API calls, improving decoupling and enabling temporal queries.

### Alternative Event Streaming Platforms

**Apache Pulsar** - 2012 and **Open-sourced in 2016** (joined Apache Software Foundation i.e., ASF)

Developed at Yahoo, Pulsar challenged Kafka with a different architecture.

**Pulsar's architecture:**
```
Producers ──────────────────────────────────→ Consumers
              ↓                        ↑
┌─────────────────────────────────────────────────────┐
│         Broker Layer (Stateless)                    │
│  - Client connections & routing                     │
│  - Subscription management                          │
│  - Load balancing                                   │
│  - No data storage (scales independently)           │
└─────────────────────────────────────────────────────┘
              ↓ Write                 ↑ Read
┌─────────────────────────────────────────────────────┐
│      Apache BookKeeper (Persistence Layer)          │
│  - Ledgers (append-only log segments)               │
│  - Bookies (storage nodes)                          │
│  - Multi-bookie replication                         │
│  - Scales independently from brokers                │
└─────────────────────────────────────────────────────┘
              ↓
       [Distributed Storage]
```

**Why separate compute and storage?**

The separation of compute (brokers) and storage (BookKeeper) solves real operational problems:

**Problem 1: Scaling mismatch**
In Kafka, if you need more throughput but not storage, you still add brokers (which come with storage). 
If you need more storage but not throughput, you still add brokers (which come with compute).
This wastes resources.
With Pulsar, need more throughput? 
Add brokers. 
Need more storage? 
Add bookies. 
Scale what you actually need (e.g., Black Friday traffic spike? Add brokers temporarily without adding expensive storage nodes).

**Problem 2: Broker replacement is painful**
In Kafka, replacing a broker means migrating all its partition data to the new broker this can take hours for terabytes of data, during which cluster performance degrades.
With Pulsar, brokers are stateless—replacing one is instant since BookKeeper already has all the data (i.e., a failed broker can be replaced in seconds, not hours).

**Problem 3: Multi-region replication**
Kafka's MirrorMaker replicates entire topics between clusters, doubling storage costs and adding complexity.
Pulsar's BookKeeper can span multiple datacenters with ledgers replicated across regions—write once in Europe, automatically available in Asia.

**Key differences from Kafka:**

| Feature             | Kafka                 | Pulsar                                 |
|---------------------|-----------------------|----------------------------------------|
| **Architecture**    | Brokers store data    | Brokers stateless, BookKeeper stores   |
| **Ordering**        | Partition-level       | Can be stream-level (single partition) |
| **Multi-tenancy**   | Topic prefixes        | Native (namespaces, tenants)           |
| **Geo-replication** | MirrorMaker (complex) | Built-in replication                   |
| **Storage**         | Coupled to brokers    | Decoupled (BookKeeper)                 |
| **Tiered storage**  | Added later           | Native from start                      |

Pulsar excels in multi-tenant environments like SaaS platforms where multiple customers need isolated namespaces with their own quotas, authentication, and authorization (i.e., native tenant isolation instead of Kafka's topic naming conventions like `customer1.orders`, `customer2.orders`).
Its architecture is ideal for geo-distributed deployments with built-in cross-datacenter replication, allowing active-active setups where writes can occur in multiple regions simultaneously (e.g., users in Europe and Asia writing to their local clusters with automatic synchronization).
The stateless broker design makes it perfect for serverless and cloud-native architectures, where brokers can be quickly scaled up or down, or even replaced without data migration concerns—BookKeeper handles all the persistence.
Finally, Pulsar provides unified messaging and streaming in a single platform, supporting both traditional queue semantics (exclusive subscriptions) and Kafka-like streaming (failover and shared subscriptions) without needing separate systems.

**Apache Flink** - Initial release in 2011.

At first glance, re-search project called `Stratosphere` during 2009 in Berlin.
Stratosphere's core team donated the project to the ASF, where it was renamed as we know him today i.e., **Flink**.
While not a messaging system, Flink revolutionized stream processing.

Flink pioneered true stream processing, processing events one-by-one as they arrive rather than collecting them into micro-batches (i.e., unlike Spark Streaming which processes data in small batches of seconds, Flink achieves sub-millisecond latency by processing each event immediately).
It introduced event time semantics, allowing processing based on when events actually occurred rather than when they arrived at the system (e.g., handling out-of-order events correctly—a payment processed at 3:00 PM but arriving at 3:05 PM is still counted in the 3:00 PM window).
Flink provides exactly-once processing guarantees through distributed snapshots and two-phase commits, ensuring that even during failures, each record is processed exactly once, neither lost nor duplicated.
Finally, its complex event processing (CEP) library enables pattern detection across event streams, allowing applications to identify sequences and correlations in real-time (e.g., detecting fraud by identifying the pattern: login from New York, followed by purchase from London within 5 minutes).

Flink often consumes from **Apache Kafka** or **Apache Pulsar** for real-time analytics, forming the processing layer in modern streaming architectures.

## The Cloud-Native Era (201*-Present)

### Strimzi - Kubernetes-Native Kafka (2017, CNCF Sandbox 2019 and Incubating in 2024)

**Strimzi** brought Kafka to the cloud-native world by providing Kubernetes operators for running and managing Apache Kafka clusters.

Instead of managing Kafka as traditional infrastructure, Strimzi treats Kafka clusters as native Kubernetes resources defined through Custom Resource Definitions (CRDs).
This means deploying a Kafka cluster is as simple as applying a YAML file (e.g., `kubectl apply -f kafka-cluster.yaml`), and Strimzi's operators handle all the complexity of provisioning brokers, topics, and users.

The operators continuously monitor and reconcile the cluster state, automatically handling common operational tasks like rolling upgrades, scaling, and configuration changes without downtime (i.e., upgrading Kafka from version 4.0 to 4.1 across a 10-node cluster becomes a single YAML change that Strimzi rolls out safely).

Strimzi provides Kubernetes-native abstractions for Kafka concepts like topics, users, and connectors, making them manageable through standard Kubernetes tooling and GitOps workflows (e.g., define topics in Git, and **[Argo CD](https://argo-cd.readthedocs.io/en/stable/)** automatically syncs them to the cluster).

Organizations already running on Kubernetes who want to operate Kafka with the same declarative, cloud-native patterns they use for other workloads, avoiding the need for separate Kafka-specific tooling and processes.
Teams practicing GitOps and infrastructure-as-code who want Kafka configuration versioned in Git alongside application manifests.
Environments requiring multi-tenancy where Kubernetes namespaces naturally isolate different teams' Kafka resources.

### Redpanda - Kafka API Without JVM (2020)

**Redpanda** re-imagined Kafka's protocol in C++ for modern hardware.

Redpanda eliminates the JVM entirely, implementing Kafka's protocol in C++ using the Seastar framework, which removes garbage collection pauses and reduces memory overhead (i.e., no more tuning JVM heap sizes or dealing with stop-the-world GC events that can cause latency spikes).
The thread-per-core architecture is NUMA-aware, pinning each thread to a specific CPU core and its local memory, eliminating lock contention and context switching that plague traditional multi-threaded designs.
These optimizations enable Redpanda to achieve significantly lower p99 latencies—often 10x better than Kafka—making it suitable for latency-sensitive workloads like financial trading or real-time gaming.

**Same API as Kafka** → drop-in replacement for most use cases.

**When to consider Redpanda:**
- Lower latency requirements (sub-millisecond)
- Cost optimization (better hardware utilization)

## Domain-Specific Messaging

### Apache Iceberg - Not Messaging, But Related (2018)

While Iceberg is a table format, not a messaging system, it represents the convergence of streaming and batch:

```
┌─────────────────────────────────────────────────────────────┐
│                   Event Streaming Layer                     │
│  Kafka/Pulsar → [Events flowing continuously]               │
└────────────────────────┬────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────────┐
│                  Stream Processing Layer                    │
│  Flink/Kafka Streams → [Transform & Aggregate]              │
└────────────────────────┬────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────────┐
│                Apache Iceberg Table Format                  │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Partitioned Data (Parquet/ORC/Avro files)           │   │
│  │  + Metadata (schema evolution, snapshots)            │   │
│  │  + Time-travel (query data as of timestamp/version)  │   │
│  └──────────────────────────────────────────────────────┘   │
└────────────────────────┬────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────────┐
│                    Query Engines                            │
│  Spark │ Trino │ Presto │ Dremio                            │
│  ────────────────────────────────────────                   │
│  • Real-time analytics on streaming data                    │
│  • Time-travel: SELECT * FROM orders FOR VERSION AS OF 42   │
│  • Schema evolution without rewriting data                  │
└─────────────────────────────────────────────────────────────┘
```

Think of Iceberg as a bridge: Kafka streams events in real-time, but you **can't** run **SQL queries on Kafka directly**.
Iceberg solves this by storing those streaming events as database tables that you can query with standard SQL (e.g., stream orders from Kafka → write to Iceberg table → query `SELECT SUM(amount) FROM orders WHERE date = today()` in Spark).

The killer feature is **time-travel**: Iceberg saves snapshots of your data over time, so you can query "what did my data look like yesterday?" (e.g., `SELECT * FROM orders AS OF '2025-01-15'` shows exactly what orders existed on that date, even if you deleted some today).

In short: Kafka handles live events, Iceberg turns those events into historical tables you can query anytime.

## Lessons from History

Looking back at 60+ years of messaging evolution:

**1. Simple wins** - Complex ESBs failed, simple Kafka succeeded
**2. Open source dominates** - Every major system is open source today
**3. Storage is cheap** - Retention went from hours to forever
**4. Decoupling is worth it** - Every architecture converges on event-driven patterns
**5. Standards are hard** - JMS tried, failed. De facto standards (Kafka API) won
**6. Cloud changes everything** - Kubernetes spawn another wave of systems (e.g., Strimzi) 

## Summary

**The Past (1960s-2000s):**
Mainframe queues evolved into IBM MQ, then JMS standardized messaging, leading to open-source brokers like ActiveMQ and RabbitMQ focused on reliable delivery and transactions.
**The Revolution (2010s):** 
Kafka's distributed log architecture changed everything, making streaming distinct from messaging and enabling real-time data pipelines that replaced batch processing.
**The Present (2020s):** 
Cloud-native systems dominate with multi-tenancy, geo-distribution, unified streaming and analytics, tiered storage, and simplified alternatives like Redpanda and Strimzi.
**One thing remains constant:** Messaging systems enable decoupled, scalable, resilient architectures from IBM MQ in 1993 to Kafka, Pulsar, Flink, and Iceberg in 2025, only the scale, speed, and sophistication have evolved.

---

**References:**
- Reverse Engineering a lot of GitHub repositories such as [ActiveMQ](https://github.com/apache/activemq), 
[Apache Kafka](https://github.com/apache/kafka), [Apache Pulsar](https://github.com/apache/pulsar),
[Apache Flink](https://github.com/apache/flink), [Apache Iceberg](https://github.com/apache/iceberg),
[RedPanda](https://github.com/redpanda-data/redpanda).

**Further Reading:**
- [Apache Kafka Documentation](https://kafka.apache.org/documentation/)
- [RabbitMQ vs Kafka Comparison](https://www.rabbitmq.com/)
- [Apache Pulsar Documentation](https://pulsar.apache.org/)
- [NATS Documentation](https://docs.nats.io/)
- [Martin Kleppmann: Designing Data-Intensive Applications](https://dataintensive.net/)