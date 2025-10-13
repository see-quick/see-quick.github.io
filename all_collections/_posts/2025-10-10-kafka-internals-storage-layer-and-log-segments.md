---
layout: post
title: "20 💾 Kafka Internals #2: Storage Layer & Log Segments"
date: 2025-10-10
categories: ["apache kafka", "distributed-systems", "storage"]
---

In the [previous post](/2025/10/07/kafka-broker-request-processing), we explored how Kafka's broker processes requests using the reactor pattern. Today, we dive into how Kafka efficiently stores and retrieves billions of messages using a sophisticated storage architecture built on log segments, memory-mapped files, and clever indexing.

## Overview

Kafka's storage layer is designed around an **append-only log abstraction**. Each partition is stored as a `UnifiedLog` which consists of multiple immutable log segments. This architecture enables:

- **Sequential writes**: ~500MB/s per disk vs ~100KB/s for random writes
- **Zero-copy reads**: Direct page cache to network transfers
- **Efficient retention**: Delete entire segments, no compaction needed
- **Simple recovery**: Replay from last checkpoint

```
Partition (UnifiedLog)
├── Log Segments (ordered by base offset)
│   ├── 00000000000000000000.log       (actual messages)
│   ├── 00000000000000000000.index     (offset → position)
│   ├── 00000000000000000000.timeindex (timestamp → offset)
│   └── 00000000000000000000.txnindex  (transaction metadata)
├── 00000000000000100000.log
├── 00000000000000100000.index
└── ...
```

## Architecture Components

### Core Classes

| Component   | Location                               | Purpose                                       |
|-------------|----------------------------------------|-----------------------------------------------|
| UnifiedLog  | storage/internals/log/UnifiedLog.java  | Partition-level abstraction managing segments |
| LogSegment  | storage/internals/log/LogSegment.java  | Individual segment with data + indexes        |
| FileRecords | clients/common/record/FileRecords.java | File-backed message storage                   |
| OffsetIndex | storage/internals/log/OffsetIndex.java | Maps offsets to file positions                |
| TimeIndex   | storage/internals/log/TimeIndex.java   | Maps timestamps to offsets                    |

### File Layout on Disk

Example for topic `my-topic` partition 0:

```
/kafka-logs/my-topic-0/
├── 00000000000000000000.log         (1GB, sealed)
├── 00000000000000000000.index       (10MB)
├── 00000000000000000000.timeindex   (10MB)
├── 00000000000001000000.log         (1GB, sealed)
├── 00000000000001000000.index       (10MB)
├── 00000000000001000000.timeindex   (10MB)
├── 00000000000002000000.log         (active, growing)
├── 00000000000002000000.index       (active, sparse)
├── 00000000000002000000.timeindex   (active, sparse)
├── leader-epoch-checkpoint          (epoch boundaries)
└── partition.metadata               (topic ID)
```

**Naming convention**: `{baseOffset}.{extension}` where base offset is zero-padded to 20 digits for lexicographic sorting.

## Log Segments

A log segment is the fundamental storage unit in Kafka. Each segment contains:

1. **`.log` file** - The actual message data (FileRecords)
2. **`.index` file** - Offset index for fast lookups
3. **`.timeindex` file** - Time-based index
4. **`.txnindex` file** - Transaction index (for transactional data)

### Segment Rolling

Segments are immutable once sealed. A new segment is created ("rolled") when:

```java
// LogSegment.java:167
public boolean shouldRoll(RollParams rollParams) throws IOException {
    boolean reachedRollMs = timeWaitedForRoll(...) > rollParams.maxSegmentMs() - rollJitterMs;
    int size = size();
    return size > rollParams.maxSegmentBytes() - rollParams.messagesSize() ||
           (size > 0 && reachedRollMs) ||
           offsetIndex().isFull() || timeIndex().isFull() ||
           !canConvertToRelativeOffset(rollParams.maxOffsetInMessages());
}
```

**Trigger conditions:**
- Segment size exceeds `segment.bytes` (default: 1GB)
- Age exceeds `segment.ms` (default: 7 days)
- Offset index is full
- Time index is full
- Offset overflow (can't fit in 4-byte relative offset)

## Indexing Strategy

### Memory-Mapped Files

Kafka uses memory-mapped I/O for indexes to achieve high performance.

Why Memory Mapping?

From AbstractIndex.java:100:

```java
// AbstractIndex.java:100
private void createAndAssignMmap() throws IOException {
    RandomAccessFile raf = new RandomAccessFile(file, writable ? "rw" : "r");
    try {
        if (newlyCreated) {
            // Pre-allocate the file
            raf.setLength(roundDownToExactMultiple(maxIndexSize, entrySize()));
        }
        long length = raf.length();
        MappedByteBuffer mmap = createMappedBuffer(raf, newlyCreated, length, writable, entrySize());

        this.length = length;
        this.mmap = mmap;
    } finally {
        Utils.closeQuietly(raf, "index " + file.getName());
    }
}
```

**Benefits of memory-mapped files**:

| Benefit          | Description                                                     |
|------------------|-----------------------------------------------------------------|
| Zero-copy        | OS maps file directly to memory; no read() syscalls             |
| Page cache       | OS manages caching; warm indexes stay in RAM                    |
| Concurrent reads | Multiple threads read without locks (coordinated via remapLock) |
| Lazy loading     | Pages loaded on-demand via page faults                          |

### Index Structure

**OffsetIndex** (OffsetIndex.java:54):
- Maps logical offset → physical file position
- Sparse index: One entry every `index.interval.bytes` (default: 4KB)
- Entry size: 8 bytes (4-byte relative offset + 4-byte position)
- Uses binary search for lookups

```java
// OffsetIndex.java:97
public OffsetPosition lookup(long targetOffset) {
    return inRemapReadLock(() -> {
        ByteBuffer idx = mmap().duplicate();
        int slot = largestLowerBoundSlotFor(idx, targetOffset, IndexSearchType.KEY);
        if (slot == -1)
            return new OffsetPosition(baseOffset(), 0);
        else
            return parseEntry(idx, slot);
    });
}
```

**TimeIndex** (TimeIndex.java:54):
- Maps timestamp → offset
- Also sparse (one entry per `index.interval.bytes`)
- Entry size: 12 bytes (8-byte timestamp + 4-byte relative offset)
- Guarantees monotonically increasing timestamps

## Data Flow

### Write Path: Appending Messages

Let's trace a produce request writing to disk:

Producer → Broker → UnifiedLog.append() → LogSegment.append() → FileRecords → Disk

**Step-by-step Flow**

**1. Entry point** (UnifiedLog.java:1081):

```java
private LogAppendInfo append(MemoryRecords records, ...) {
    // Validate records
    LogAppendInfo appendInfo = analyzeAndValidateRecords(records, ...);

    synchronized (lock) {
        // Assign offsets
        PrimitiveRef.LongRef offset = PrimitiveRef.ofLong(localLog.logEndOffset());

        // Validate and possibly compress
        LogValidator validator = new LogValidator(...);
        ValidationResult validationResult = validator.validateMessagesAndAssignOffsets(...);

        // Get or create active segment
        LogSegment segment = localLog.maybeRoll(...);

        // Append to segment
        segment.append(appendInfo.lastOffset(), ..., validationResult.validatedRecords());

        // Update indexes
        updateLogEndOffset(appendInfo.lastOffset() + 1);
    }
}
```

**2. Write to FileRecords** (FileRecords.java:193):

```java
public int append(MemoryRecords records) throws IOException {
    int written = records.writeFullyTo(channel);  // Direct write to FileChannel
    size.getAndAdd(written);
    return written;
}
```

**3. Update index** (LogSegment.java - invoked during append):

```java
// Update offset index every index.interval.bytes
if (bytesSinceLastIndexEntry > indexIntervalBytes) {
    offsetIndex().append(offset, physicalPosition);
    timeIndex().append(timestamp, offset);
    bytesSinceLastIndexEntry = 0;
}
```

**Write Performance**

| Technique   | Benefit                                               |
|-------------|-------------------------------------------------------|
| Append-only | Sequential writes ~100MB/s vs random ~100KB/s on HDDs |
| Batching    | Multiple records per write syscall                    |
| Page cache  | OS buffers writes; sync based on flush.ms             |
| Direct I/O  | FileChannel writes bypass JVM heap                    |

### Read Path: Fetching Messages

**Fetch flow:**

```
Consumer → Broker → UnifiedLog.read() → LogSegment.read() → FileRecords → Zero-copy transfer
```

**Step-by-step Flow**

**1. Find starting segment** (UnifiedLog.java:1604):

```java
public FetchDataInfo read(long startOffset, int maxLength, FetchIsolation isolation, ...) {
    checkLogStartOffset(startOffset);

    // Determine max offset based on isolation level
    LogOffsetMetadata maxOffsetMetadata = switch (isolation) {
        case LOG_END -> localLog.logEndOffsetMetadata();
        case HIGH_WATERMARK -> fetchHighWatermarkMetadata();
        case TXN_COMMITTED -> fetchLastStableOffsetMetadata();
    };

    return localLog.read(startOffset, maxLength, minOneMessage, maxOffsetMetadata, ...);
}
```

**2. Use offset index to find position** (simplified):

```java
// Find segment containing startOffset (binary search on segment base offsets)
LogSegment segment = segments.floorEntry(startOffset);

// Look up position in offset index
OffsetPosition startPosition = segment.offsetIndex().lookup(startOffset);

// Read from file starting at that position
FileRecords records = segment.log().slice(startPosition.position(), maxLength);
```

**3. Zero-copy transfer** (for network sends):

```java
// FileRecords can transfer directly to socket via sendfile()
long bytesTransferred = records.writeTo(channel, position, maxSize);
```

### Binary Search for Offset Lookup

The offset index uses a clever binary search implementation:

```java
// AbstractIndex.java
protected int largestLowerBoundSlotFor(ByteBuffer idx, long target, IndexSearchType searchEntity) {
    // Binary search for largest entry <= target
    int lo = 0;
    int hi = entries() - 1;

    while (lo < hi) {
        int mid = ceil(hi, lo);
        long found = getSearchEntity(idx, mid, searchEntity);
        if (found == target)
            return mid;
        else if (found < target)
            lo = mid;
        else
            hi = mid - 1;
    }
    return lo;
}
```

**Time complexity:** O(log N) where N = number of index entries

**Example:**
- Segment has 1GB of data
- Index entry every 4KB → ~250,000 entries
- Binary search: ~18 comparisons to find offset

## Log Retention & Compaction

Kafka supports two retention policies:

1. **Delete** - Remove old segments based on time/size
2. **Compact** - Keep only the latest value for each key

### Log Compaction

From LogCleaner.java:49:

> The cleaner is responsible for removing obsolete records from logs which have the "compact" retention strategy.
>
> A message with key K and offset O is obsolete if there exists a message with key K and offset O' such that O < O'.

**Compaction Process:**

1. Build key→offset map for dirty section (OffsetMap)
2. Recopy segments, omitting obsolete messages
3. Merge small segments to avoid fragmentation
4. Swap cleaned segments atomically

**OffsetMap: Memory-Efficient Deduplication**

The OffsetMap (SkimpyOffsetMap.java) is a specialized hash table:

- **Preallocated array**: No resizing, fixed memory
- **Open addressing**: Linear probing for collisions
- **24-byte entries**: Hash (8B) + Offset (8B) + Position (8B)
- **Configurable size**: `log.cleaner.dedupe.buffer.size` (default: 128MB)
- **Capacity**: 128MB / 24B ≈ 5.5M unique keys per cleaning

### Retention Policies

**Time-based retention** (`log.retention.ms`):

```java
// Delete segments older than retention time
segments.forEach(segment -> {
    if (segment.largestTimestamp() < now - retentionMs) {
        deleteSegment(segment);
    }
});
```

**Size-based retention** (`log.retention.bytes`):

```java
// Delete oldest segments until size < retention.bytes
while (totalSize > retentionBytes && segments.size() > 1) {
    deleteSegment(segments.firstEntry());
}
```

## Design Patterns & Performance

### Key Design Patterns

| Pattern                | Implementation               | Benefit                                 |
|------------------------|------------------------------|-----------------------------------------|
| Log-structured storage | Append-only segments         | Sequential writes, simple recovery      |
| Sparse indexing        | Entry every 4KB              | Memory-efficient with good lookup speed |
| Memory mapping         | MappedByteBuffer for indexes | Zero-copy, OS page cache integration    |
| Segment rolling        | Immutable sealed segments    | Parallel operations, easy deletion      |
| Zero-copy transfer     | sendfile() for network       | Bypass kernel→user→kernel copies        |
| Tiered storage         | Local + remote segments      | Cost efficiency for old data            |

## Summary

Kafka's storage layer achieves exceptional performance through:

1. Append-only log segments - Leverage sequential I/O
2. Memory-mapped indexes - Fast lookups with OS page cache
3. Sparse indexing - Balance memory vs lookup speed
4. Zero-copy transfers - Minimize data copying
5. Segment-based lifecycle - Simple retention and compaction

The design allows Kafka to handle millions of messages/second while maintaining durability and efficient disk usage.

In the next post, we'll explore the replication protocol (i.e., how Kafka ensures data durability across brokers using 
leader-follower replication and the high watermark mechanism).

  ---
References in this post point to Apache Kafka 4.1.0+ codebase in the storage module.