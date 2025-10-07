---
layout: post
title: "19 📨 Kafka Internals #1: Broker Request Processing Flow"
date: 2025-10-07
categories: ["kafka", "distributed-systems"]
---

This is the first post in a series exploring Apache Kafka's internal architecture. 
In this series, we'll dive into:

1. **Broker Request Processing Flow** (this post)
2. Storage Layer & Log Segments (coming soon)
3. Replication Protocol (coming soon)
4. Consumer Groups & Coordination (coming soon)
5. and many more...

Today, we'll focus on how a Kafka broker processes client requests - from receiving bytes on a socket to writing data to disk and sending a response.

## High-Level Architecture

Kafka uses a **reactor pattern** to separate network I/O from request processing. 
If you want to learn about **reactor pattern** I recommend this [paper](http://www.dre.vanderbilt.edu/~schmidt/PDF/reactor-siemens.pdf) from 1995. 
This architecture enables high throughput by:

- **Non-blocking I/O for network operations**: 

Using Java NIO `Selector`, a single `Processor` thread monitors hundreds of socket connections simultaneously without blocking. 
When a socket has data ready, the selector returns immediately (i.e., no threads waste time waiting on I/O).

- **Dedicated thread pools for CPU-intensive work**: 

Network I/O runs on `Processor` threads (typically 3-8; may vary), while request processing runs on a separate pool of `KafkaRequestHandler` threads (typically 8-16; also may vary). 
This prevents slow request processing from blocking network operations.

- **Async callbacks for operations that take time (like replication)**: 

When `acks=-1`, the handler thread doesn't wait for replication. 
Instead, it registers a callback with `DelayedProduce` and returns to process other requests. 
When all replicas acknowledge, the callback fires and sends the response.

- **Backpressure mechanisms to prevent overload**: 

When a request is queued, the broker "mutes" that socket connection; meaning it stops reading more data from that client until the current request completes. 
Combined with bounded request queues, this prevents memory exhaustion during traffic spikes.

## Request Processing Pipeline

Here's the journey of a single produce request through the broker:

```
   Client              Acceptor           Processor         RequestChannel      KafkaRequestHandler      KafkaApis      ReplicaManager
     |                    |                   |                    |                      |                    |                 |
     |--TCP Connect------>|                   |                    |                      |                    |                 |
     |                    |                   |                    |                      |                    |                 |
     |                    |--New Socket------>|                    |                      |                    |                 |
     |                    |                   |                    |                      |                    |                 |
     |--Produce Request---------------------->|                    |                      |                    |                 |
     |                    |                   |                    |                      |                    |                 |
     |                    |              [Parse Request]           |                      |                    |                 |
     |                    |                   |                    |                      |                    |                 |
     |                    |                   |--Enqueue---------->|                      |                    |                 |
     |                    |                   |                    |                      |                    |                 |
     |                    |              [Mute Connection]         |                      |                    |                 |
     |                    |                   |                    |                      |                    |                 |
     |                    |                   |                    |--Dequeue Request---->|                    |                 |
     |                    |                   |                    |                      |                    |                 |
     |                    |                   |                    |                      |--Route by API----->|                 |
     |                    |                   |                    |                      |                    |                 |
     |                    |                   |                    |                      |                    |--Append-------->|
     |                    |                   |                    |                      |                    |                 |
     |                    |                   |                    |                      |                    |           [Write to Log]
     |                    |                   |                    |                      |                    |                 |
     |                    |                   |                    |                      |                    |<--Callback------|
     |                    |                   |                    |                      |                    |                 |
     |                    |                   |                    |                      |<--Response---------|                 |
     |                    |                   |                    |                      |                    |                 |
     |                    |                   |<--Send Response---------------------------|                    |                 |
     |                    |                   |                    |                      |                    |                 |
     |                    |              [Unmute Connection]       |                      |                    |                 |
     |                    |                   |                    |                      |                    |                 |
     |<--Produce Response---------------------|                    |                      |                    |                 |
     |                    |                   |                    |                      |                    |                 |
```

**Pipeline stages**:

| Stage          | Component                | Threads        | Purpose                         |
|----------------|--------------------------|----------------|---------------------------------|
| 1. Accept      | `Acceptor`               | 1 per listener | Accept TCP connections          |
| 2. Network I/O | `Processor`              | N per listener | Read/write bytes, parse headers |
| 3. Queue       | `RequestChannel`         | -              | Decouple I/O from processing    |
| 4. Processing  | `KafkaRequestHandler`    | M handlers     | Route and execute requests      |
| 5. Response    | Back through `Processor` | -              | Write response to socket        |

### 1. Network Layer - SocketServer

**Location**: `kafka/network/SocketServer.scala`

The `SocketServer` manages all network communication:

```
Client → TCP Connection → Acceptor → Processor (NIO Selector)
```

**Processor Event Loop**:
1. `configureNewConnections()` - Set up new sockets
2. `processNewResponses()` - Queue responses to send
3. `poll()` - NIO selector.select() for ready I/O
4. `processCompletedReceives()` - Parse requests
5. `processCompletedSends()` - Cleanup after sending

When a complete request arrives (line 1019):
- Parse the request header from bytes
- Create a `RequestChannel.Request` object
- Send it to the `RequestChannel`
- **Mute the connection** - critical for backpressure! No more data is read until this request is processed

### 2. Request Queue - RequestChannel

**Location**: `kafka/network/RequestChannel.scala`

A bounded queue (configured by `queued.max.requests`) that:
- Receives requests from `Processor` threads
- Provides requests to `KafkaRequestHandler` threads
- Prevents handler threads from blocking I/O threads

### 3. Handler Thread Pool

**Location**: `kafka/server/KafkaRequestHandler.scala`

M handler threads (lines 103-177) run this loop:

```scala
while (isRunning) {
  val request = requestChannel.receiveRequest()  // Block until request available
  apis.handle(request, requestLocal)              // Process it
}
```

Metrics tracked: idle time, processing time per API key.

### 4. Request Router - KafkaApis

**Location**: `kafka/server/KafkaApis.scala`

The `handle()` method (line 151) is a giant pattern match routing to specific handlers:

```scala
request.header.apiKey match {
  case ApiKeys.PRODUCE        → handleProduceRequest()
  case ApiKeys.FETCH          → handleFetchRequest()
  case ApiKeys.JOIN_GROUP     → handleJoinGroupRequest()
  case ApiKeys.CREATE_TOPICS  → forwardToController()
  // ... 50+ API types
}
```

### 5. Example: Produce Request

Let's trace a produce request writing data to a topic:

**KafkaApis.handleProduceRequest()** (line 388):

```
1. Authorization
   ├─ Check transactional ID (if transactional)
   ├─ Verify topic permissions
   └─ ACL checks

2. Validation
   └─ Validate record batch format

3. Delegate to ReplicaManager
   └─ replicaManager.handleProduceAppend()

4. Define callback
   └─ sendResponseCallback() - invoked when append completes
```

**ReplicaManager.handleProduceAppend()** (line 734):

```
1. Transaction verification (if needed)

2. appendToLocalLog()
   └─ For each partition:
      ├─ partition.appendRecordsToLeader()
      ├─ Write to UnifiedLog (disk)
      └─ Update metrics (bytes_in, messages_in)

3. Delayed produce handling (if acks=-1)
   └─ Add to DelayedProduce purgatory
      └─ Wait for min.isr replicas to acknowledge
```

### 6. Response Flow

Once the append completes (or times out):

```
1. Callback invoked
   └─ sendResponseCallback() in KafkaApis

2. Apply quotas
   ├─ Bandwidth throttling
   └─ Request rate limiting

3. Send response
   └─ requestChannel.sendResponse()

4. Processor picks up response
   ├─ processNewResponses()
   ├─ Write bytes to socket
   └─ Unmute connection (ready for next request)
```

## Key Design Patterns

| Pattern                | Implementation                                  | Benefit                   |
|------------------------|-------------------------------------------------|---------------------------|
| **Reactor**            | Processors (I/O) separate from Handlers (logic) | Scales independently      |
| **Thread-per-request** | Handler pool processes requests                 | Isolation, fairness       |
| **Async callbacks**    | Delayed operations use callbacks                | Non-blocking for long ops |
| **Backpressure**       | Muted connections + bounded queues              | Prevents overload         |
| **Purgatory**          | Delayed ops wait for conditions                 | Efficient waiting         |

## The Purgatory Pattern

Worth highlighting: the **DelayedProduce purgatory** is Kafka's way of efficiently waiting for replication when `acks=-1`.

Instead of blocking a handler thread, the operation:
1. Gets added to a purgatory (a timing wheel data structure)
2. Handler thread is freed to process other requests
3. When replicas acknowledge OR timeout expires → callback fires
4. Response is sent

## Backpressure in Action

The connection muting mechanism (line 1055) is elegant:

```
Request arrives → Parse → Queue → MUTE CONNECTION
                                      ↓
Response sent ← Write ← Process ← UNMUTE CONNECTION
```

This prevents:
- Memory exhaustion from buffering too many requests
- Handler threads drowning in work
- Cascading failures under load

## Summary

The Kafka broker's request processing architecture achieves high throughput through:

1. **Separation of concerns**: I/O threads vs processing threads
2. **Non-blocking I/O**: NIO selectors for network operations
3. **Bounded queues**: Explicit limits prevent resource exhaustion
4. **Async patterns**: Callbacks and purgatories for long operations
5. **Flow control**: Connection muting provides natural backpressure

In the next post, we'll explore the **storage layer** i.e., how Kafka efficiently writes and reads data from disk using log segments and memory-mapped files.

---

*This series dives into Kafka's source code to understand the design decisions behind one of the most popular distributed systems. 
All references are to the Kafka codebase (currently Apache Kafka 4.1.0+) .*