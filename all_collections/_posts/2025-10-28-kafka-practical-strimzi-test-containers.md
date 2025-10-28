---
layout: post
title: "25 🔧 Kafka Practical: Testing with Strimzi Test Containers"
date: 2025-10-28
categories: ["strimzi", "apache-kafka", "testing", "testcontainers"]
---

Testing Kafka-based applications has historically been challenging. 
You either needed a full Kafka cluster running locally, complex mocking infrastructure, or embedded Kafka instances that don't reflect production behavior.

Enter **Strimzi Test Containers** - a library that makes spinning up real multi-node Kafka/KafkaConnect clusters for testing as simple as writing a unit test.

## (WHAT) are Strimzi Test Containers?

Strimzi Test Containers is a specialized implementation of the [Testcontainers](https://www.testcontainers.org/) framework designed for Strimzi needs. 
It allows you to programmatically create and manage Docker-based Kafka clusters in your tests, supporting both single-node and **multi-node cluster configurations**.
You can easily create 3, 5 or more Kafka nodes for realistic testing.  
Moreover, you can choose either to use combined roles (i.e., controller + broker running in the same node) or use dedicated roles (i.e., separate controllers and brokers).
Strimzi Test Containers does a lot of automatic configuration for you (e.g., quorum voter setup, replication factors and more).
Additionally, you can configure the log collection for debugging cluster behaviour.
Lastly, there is a build-in support for testing Kafka Connect clusters with `StrimziConnectCluster`.

The project is maintained by the Strimzi community and available at [github.com/strimzi/test-container](https://github.com/strimzi/test-container).

## (WHY) use Strimzi Test Containers

Testing with real Kafka clusters instead of mocks ensures your application behaves correctly in production scenarios like leader elections, consumer group rebalancing, and partition failures. 
Strimzi Test Containers eliminates the complexity of managing Docker Compose files or standalone cluster setups, giving you multi-node Kafka environments with just a few lines of code. 
This approach catches integration issues early while keeping your test suite maintainable and fast enough for **CI/CD pipelines**.

## (HOW) Getting Started

### Maven Dependency

Add the Strimzi Test Containers dependency to your `pom.xml`:

```xml
<dependency>
    <groupId>io.strimzi</groupId>
    <artifactId>strimzi-test-container</artifactId>
    <version>0.113.0</version>
    <scope>test</scope>
</dependency>
```

For Gradle:

```gradle
testImplementation 'io.strimzi:strimzi-test-container:0.113.0'
```

### Basic Example: Multi-Node Kafka Cluster

Here's a simple 3-node Kafka cluster using **JUnit 5**:

```java
import io.strimzi.test.container.StrimziKafkaCluster;
import org.apache.kafka.clients.admin.AdminClient;
import org.apache.kafka.clients.admin.AdminClientConfig;
import org.apache.kafka.clients.admin.NewTopic;
import org.apache.kafka.clients.consumer.ConsumerConfig;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.apache.kafka.clients.consumer.ConsumerRecords;
import org.apache.kafka.clients.consumer.KafkaConsumer;
import org.apache.kafka.clients.producer.KafkaProducer;
import org.apache.kafka.clients.producer.ProducerConfig;
import org.apache.kafka.clients.producer.ProducerRecord;
import org.apache.kafka.common.serialization.StringDeserializer;
import org.apache.kafka.common.serialization.StringSerializer;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;

import static org.hamcrest.CoreMatchers.is;
import static org.hamcrest.MatcherAssert.assertThat;
import static org.junit.jupiter.api.Assertions.assertEquals;

class KafkaClusterTest {

    private static StrimziKafkaCluster kafkaCluster;

    @BeforeAll
    static void setup() {
        kafkaCluster = new StrimziKafkaCluster.StrimziKafkaClusterBuilder()
            .withNumberOfBrokers(3)
            .withInternalTopicReplicationFactor(3)
            .withSharedNetwork()
            .build();

        kafkaCluster.start();
    }

    @AfterAll
    static void teardown() {
        kafkaCluster.stop();
    }

    @Test
    void testClusterHasThreeNodes() throws ExecutionException, InterruptedException {
        try (AdminClient admin = AdminClient.create(Map.of(
            AdminClientConfig.BOOTSTRAP_SERVERS_CONFIG,
            kafkaCluster.getBootstrapServers()))) {

            var nodes = admin.describeCluster().nodes().get();
            assertEquals(3, nodes.size(), "Cluster should have 3 nodes");
        }
    }

    @Test
    void testProduceToReplicatedTopic() throws Exception {
        try (final AdminClient adminClient = AdminClient.create(Map.of(
            AdminClientConfig.BOOTSTRAP_SERVERS_CONFIG, kafkaCluster.getBootstrapServers()));
             KafkaProducer<String, String> producer = new KafkaProducer<>(
                 Map.of(
                     ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, kafkaCluster.getBootstrapServers(),
                     ProducerConfig.CLIENT_ID_CONFIG, UUID.randomUUID().toString(),
                     ProducerConfig.ACKS_CONFIG, "all"
                 ),
                 new StringSerializer(),
                 new StringSerializer()
             );
             KafkaConsumer<String, String> consumer = new KafkaConsumer<>(
                 Map.of(
                     ConsumerConfig.BOOTSTRAP_SERVERS_CONFIG, kafkaCluster.getBootstrapServers(),
                     ConsumerConfig.GROUP_ID_CONFIG, "tc-" + UUID.randomUUID(),
                     ConsumerConfig.AUTO_OFFSET_RESET_CONFIG, "earliest"
                 ),
                 new StringDeserializer(),
                 new StringDeserializer()
             )
        ) {
            final String topicName = "replicated-topic";
            final String recordKey = "key";
            final String recordValue = "value";

            final Collection<NewTopic> topics = List.of(new NewTopic(topicName, 6, (short) 3));
            adminClient.createTopics(topics).all().get(30, TimeUnit.SECONDS);

            consumer.subscribe(List.of(topicName));

            producer.send(new ProducerRecord<>(topicName, recordKey, recordValue)).get();

            Utils.waitFor("Consumer records are present", Duration.ofSeconds(1), Duration.ofMinutes(2),
                () -> {
                    ConsumerRecords<String, String> records = consumer.poll(Duration.ofMillis(100));

                    if (records.isEmpty()) {
                        return false;
                    }

                    // verify count
                    assertThat(records.count(), is(1));

                    ConsumerRecord<String, String> consumerRecord = records.records(topicName).iterator().next();

                    // verify content of the record
                    assertThat(consumerRecord.topic(), is(topicName));
                    assertThat(consumerRecord.key(), is(recordKey));
                    assertThat(consumerRecord.value(), is(recordValue));

                    return true;
                });
        }
    }
}
```

## Understanding Node Roles: Combined vs Dedicated

One of StrimziKafkaCluster's features is its support for different node role configurations.

### Combined Roles (Default)

By default, StrimziKafkaCluster creates nodes with **combined roles**, where each node acts as both a KRaft controller and a broker. 
This is simpler and perfect for most testing scenarios:

```java
StrimziKafkaCluster kafkaCluster = new StrimziKafkaCluster.StrimziKafkaClusterBuilder()
    .withNumberOfBrokers(3)
    .build();

kafkaCluster.start();

// Creates 3 nodes, each with node.id and broker.id set to 0, 1, 2
// All nodes participate in both:
// - KRaft quorum (controller duties)
// - Data plane (broker duties)
```

**Architecture:**

```
┌───────────────────────────────────────────────────────┐
│         3-Node Combined-Role Cluster                  │
│                                                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │   Node 0     │  │   Node 1     │  │   Node 2     │ │
│  │              │  │              │  │              │ │
│  │ Controller   │  │ Controller   │  │ Controller   │ │
│  │    +         │  │    +         │  │    +         │ │
│  │  Broker      │  │  Broker      │  │  Broker      │ │
│  └──────────────┘  └──────────────┘  └──────────────┘ │
└───────────────────────────────────────────────────────┘
```

Each node handles both metadata operations (via KRaft) and client requests (as a broker).

### Dedicated Roles (Production-like)

For more realistic testing, you can separate controller and broker responsibilities:

```java
StrimziKafkaCluster kafkaCluster = new StrimziKafkaCluster.StrimziKafkaClusterBuilder()
    .withNumberOfBrokers(3)
    .withDedicatedRoles()
    .withNumberOfControllers(3)
    .build();

kafkaCluster.start();

// Creates:
// - 3 controller-only nodes (IDs: 0, 1, 2)
// - 3 broker-only nodes (IDs: 3, 4, 5)
// Total: 6 containers
```

**Architecture:**

```
┌────────────────────────────────────────────────────────┐
│         6-Node Dedicated-Role Cluster                  │
│                                                        │
│  Controllers (Metadata Management)                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ Controller 0 │  │ Controller 1 │  │ Controller 2 │  │
│  │ (node.id=0)  │  │ (node.id=1)  │  │ (node.id=2)  │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
│                                                        │
│  Brokers (Data Plane)                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │  Broker 3    │  │  Broker 4    │  │  Broker 5    │  │
│  │(broker.id=3) │  │(broker.id=4) │  │(broker.id=5) │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
└────────────────────────────────────────────────────────┘
```

**Why use dedicated roles?**

- **Production parity**: Many production deployments separate controllers and brokers
- **Resource isolation**: Controllers aren't affected by broker data plane load
- **Failure testing**: Test scenarios where only controllers or only brokers fail
- **Scaling patterns**: Test independent scaling of controllers vs brokers

**When to use each:**

| Use Combined Roles When...                  | Use Dedicated Roles When...                        |
|---------------------------------------------|----------------------------------------------------|
| Testing basic producer/consumer logic       | Testing controller failover scenarios              |
| Integration tests for application code      | Testing metadata operations under load             |
| Validating Kafka Streams applications       | Simulating production cluster architectures        |
| Resource-constrained environments (CI)      | Testing quorum voter changes                       |
| You need faster test execution              | You want maximum production realism                |

## Advanced Configuration

### Custom Kafka Settings

StrimziKafkaCluster allows you to pass any Kafka broker configuration:

```java
StrimziKafkaCluster kafkaCluster = new StrimziKafkaCluster.StrimziKafkaClusterBuilder()
    .withNumberOfBrokers(3)
    .withAdditionalKafkaConfiguration(Map.of(
        "log.retention.hours", "1",
        "log.segment.bytes", "104857600",
        "compression.type", "snappy",
        "min.insync.replicas", "2"
    ))
    .build();
```

### Specific Kafka Version

Test against specific Kafka versions:

```java
StrimziKafkaCluster kafkaCluster = new StrimziKafkaCluster.StrimziKafkaClusterBuilder()
    .withNumberOfBrokers(3)
    .withKafkaVersion("4.0.1")
    .build();
```

Supported versions are listed in `kafka_versions.json` (typically includes the last few major releases).

### Log Collection for Debugging

When tests fail, you need logs. StrimziKafkaCluster makes this easy:

```java
StrimziKafkaCluster kafkaCluster = new StrimziKafkaCluster.StrimziKafkaClusterBuilder()
    .withNumberOfBrokers(3)
    .withLogCollection("target/kafka-logs/")
    .build();

kafkaCluster.start();
// ... run tests
kafkaCluster.stop();

// After stop(), logs are saved to:
// target/kafka-logs/kafka-container-0.log
// target/kafka-logs/kafka-container-1.log
// target/kafka-logs/kafka-container-2.log
```

With **dedicated roles**, logs are organized by role:

```java
StrimziKafkaCluster kafkaCluster = new StrimziKafkaCluster.StrimziKafkaClusterBuilder()
    .withNumberOfBrokers(3)
    .withDedicatedRoles()
    .withNumberOfControllers(3)
    .withLogCollection("target/kafka-logs/")
    .build();

// After stop(), logs are saved to:
// target/kafka-logs/kafka-controller-0.log
// target/kafka-logs/kafka-controller-1.log
// target/kafka-logs/kafka-controller-2.log
// target/kafka-logs/kafka-broker-3.log
// target/kafka-logs/kafka-broker-4.log
// target/kafka-logs/kafka-broker-5.log
```

## Testing Scenarios

### Scenario 1: Testing Replication and Leader Election

Let's test what happens when a broker goes down:

```java
// assumption that you have kafkaCluster up (from the previous example) 
@Test
void testLeaderElectionAfterBrokerFailure() throws Exception {
    String topic = "failover-test";

    // Create topic with replication factor 3
    try (AdminClient admin = AdminClient.create(Map.of(
        AdminClientConfig.BOOTSTRAP_SERVERS_CONFIG,
        kafkaCluster.getBootstrapServers()))) {

        admin.createTopics(List.of(
            new NewTopic(topic, 1, (short) 3)
        )).all().get();

        // Wait for topic to be created
        Thread.sleep(1000);

        // Get initial leader
        var topicDescription = admin.describeTopics(List.of(topic)).allTopicNames().get().get(topic);
        int initialLeader = topicDescription.partitions().get(0).leader().id();

        System.out.println("Initial leader: broker-" + initialLeader);

        // Stop the leader broker
        var brokers = new ArrayList<>(kafkaCluster.getBrokers());
        StrimziKafkaContainer leaderBroker = (StrimziKafkaContainer) brokers.get(initialLeader);
        leaderBroker.stop();

        // Wait for leader election (it would be better to use dynamic wait but for brevity...)
        Thread.sleep(10_000);

        // Verify new leader elected
        topicDescription = admin.describeTopics(List.of(topic)).allTopicNames().get().get(topic);
        int newLeader = topicDescription.partitions().get(0).leader().id();

        System.out.println("New leader after failure: broker-" + newLeader);

        assertNotEquals(initialLeader, newLeader,
            "Leader should have changed after broker failure");

        // Verify we can still produce
        Properties props = new Properties();
        props.put(ProducerConfig.BOOTSTRAP_SERVERS_CONFIG,
            kafkaCluster.getBootstrapServers());
        props.put(ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG,
            StringSerializer.class.getName());
        props.put(ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG,
            StringSerializer.class.getName());
        props.put(ProducerConfig.ACKS_CONFIG, "all");

        try (KafkaProducer<String, String> producer = new KafkaProducer<>(props)) {
            producer.send(new ProducerRecord<>(topic, "key", "value-after-failure")).get();
        }
    }
}
```

This test validates:
- Kafka's automatic leader election works correctly
- The cluster remains available after losing a broker
- Replication ensures no data loss

### Scenario 2: Testing Consumer Group Rebalancing

Building on our [previous post about consumer groups](/posts/kafka-practical-consumer-groups):

```java
@Test
void testConsumerGroupRebalancingInCluster() throws Exception {
    String topic = "rebalance-test";
    String groupId = "test-group";

    // Create topic with 6 partitions across 3 brokers
    try (AdminClient admin = AdminClient.create(Map.of(
        AdminClientConfig.BOOTSTRAP_SERVERS_CONFIG,
        kafkaCluster.getBootstrapServers()))) {

        admin.createTopics(List.of(
            new NewTopic(topic, 6, (short) 3)
        )).all().get();
    }

    // Start consumer 1
    Properties consumerProps = new Properties();
    consumerProps.put(ConsumerConfig.BOOTSTRAP_SERVERS_CONFIG,
        kafkaCluster.getBootstrapServers());
    consumerProps.put(ConsumerConfig.GROUP_ID_CONFIG, groupId);
    consumerProps.put(ConsumerConfig.AUTO_OFFSET_RESET_CONFIG, "earliest");
    consumerProps.put(ConsumerConfig.KEY_DESERIALIZER_CLASS_CONFIG,
        StringDeserializer.class.getName());
    consumerProps.put(ConsumerConfig.VALUE_DESERIALIZER_CLASS_CONFIG,
        StringDeserializer.class.getName());

    KafkaConsumer<String, String> consumer1 = new KafkaConsumer<>(consumerProps);
    consumer1.subscribe(List.of(topic));

    // Wait for initial partition assignment
    Utils.waitFor("Consumer1 gets all 6 partitions", Duration.ofSeconds(1), Duration.ofSeconds(30),
        () -> {
            consumer1.poll(Duration.ofMillis(100));
            return consumer1.assignment().size() == 6;
        });

    // Verify consumer1 has all 6 partitions
    assertEquals(6, consumer1.assignment().size());

    // Start consumer 2 (triggers rebalance)
    KafkaConsumer<String, String> consumer2 = new KafkaConsumer<>(consumerProps);
    consumer2.subscribe(List.of(topic));

    // Wait for rebalance to complete - both consumers should have 3 partitions each
    Utils.waitFor("Rebalance completes with 3-3 partition split", Duration.ofSeconds(1), Duration.ofSeconds(30),
        () -> {
            consumer1.poll(Duration.ofMillis(100));
            consumer2.poll(Duration.ofMillis(100));
            return consumer1.assignment().size() == 3 && consumer2.assignment().size() == 3;
        });

    // After rebalance, partitions split 3-3
    assertEquals(3, consumer1.assignment().size());
    assertEquals(3, consumer2.assignment().size());

    consumer1.close();
    consumer2.close();
}
```

If you want to use wait/until method, here is a the implementation of it: 
```java
/**
     * Poll the given {@code ready} function every {@code pollInterval} until it returns true,
     * or throw a WaitException if it doesn't returns true within {@code timeout}.
     * @return The remaining time left until timeout occurs
     * (helpful if you have several calls which need to share a common timeout),
     *
     * @param description waiting for `description`
     * @param pollInterval poll interval
     * @param timeout timeout
     * @param ready lambda predicate
     */
    static long waitFor(String description, Duration pollInterval, Duration timeout, BooleanSupplier ready) {
        LOGGER.debug("Waiting for {}", description);
        long deadline = System.currentTimeMillis() + timeout.toMillis();
        String exceptionMessage = null;
        int exceptionCount = 0;
        StringWriter stackTraceError = new StringWriter();

        while (true) {
            boolean result;
            try {
                result = ready.getAsBoolean();
            } catch (Exception e) {
                exceptionMessage = e.getMessage();
                if (++exceptionCount == 1 && exceptionMessage != null) {
                    // Log the first exception as soon as it occurs
                    LOGGER.error("Exception waiting for {}, {}", description, exceptionMessage);
                    // log the stacktrace
                    e.printStackTrace(new PrintWriter(stackTraceError));
                }
                result = false;
            }
            long timeLeft = deadline - System.currentTimeMillis();
            if (result) {
                return timeLeft;
            }
            if (timeLeft <= 0) {
                if (exceptionCount > 1) {
                    LOGGER.error("Exception waiting for {}, {}", description, exceptionMessage);

                    if (!stackTraceError.toString().isEmpty()) {
                        // printing handled stacktrace
                        LOGGER.error(stackTraceError.toString());
                    }
                }
                WaitException waitException = new WaitException("Timeout after " + timeout.toMillis() + " ms waiting for " + description);
                waitException.addSuppressed(waitException);
                throw waitException;
            }
            long sleepTime = Math.min(pollInterval.toMillis(), timeLeft);
            if (LOGGER.isTraceEnabled()) {
                LOGGER.trace("{} not satisfied, will try again in {} ms ({}ms till timeout)", description, sleepTime, timeLeft);
            }
            try {
                Thread.sleep(sleepTime);
            } catch (InterruptedException e) {
                return deadline - System.currentTimeMillis();
            }
        }
    }
```

### Scenario 3: Testing with Dedicated Controller Failover

Test what happens when a controller fails in a dedicated-role cluster:

```java
@Test
void testControllerFailoverInDedicatedRoleCluster() throws Exception {
    kafkaCluster = new StrimziKafkaCluster.StrimziKafkaClusterBuilder()
        .withNumberOfBrokers(2)
        .withDedicatedRoles()
        .withNumberOfControllers(3)
        .withLogCollection("target/controller-failover-logs/")
        .build();

    kafkaCluster.start();

    // Connect to brokers - they will communicate with controllers internally
    try (AdminClient admin = AdminClient.create(Map.of(
        AdminClientConfig.BOOTSTRAP_SERVERS_CONFIG,
        kafkaCluster.getBootstrapServers()))) {

        // Verify cluster is operational before failover
        String topic1 = "pre-failover-topic";
        admin.createTopics(List.of(
            new NewTopic(topic1, 3, (short) 2)
        )).all().get();

        var topicsBefore = admin.listTopics().names().get();
        assertTrue(topicsBefore.contains(topic1),
            "Should be able to create topics before controller failover");

        // Stop one of the controller nodes (the first one, which has ID 0)
        var controllers = new ArrayList<>(kafkaCluster.getControllers());
        StrimziKafkaContainer controllerToStop = (StrimziKafkaContainer) controllers.get(0);
        int stoppedControllerId = controllerToStop.getBrokerId();
        System.out.println("Stopping controller with ID: " + stoppedControllerId);
        controllerToStop.stop();

        // Wait for cluster to stabilize after controller loss
        Thread.sleep(10_000);

        // Verify cluster still operational - the remaining 2 controllers should maintain quorum
        String topic2 = "post-failover-topic";
        admin.createTopics(List.of(
            new NewTopic(topic2, 3, (short) 2)
        )).all().get();

        var topicsAfter = admin.listTopics().names().get();
        assertTrue(topicsAfter.contains(topic2),
            "Should be able to create topics after controller failover");

        System.out.println("Controller failover successful - cluster remains operational with 2/3 controllers");
    }
}
```

This test demonstrates:
- Controller failover in dedicated-role clusters
- Cluster continues operating after controller failure
- Metadata operations (topic creation) work after failover

Also you can check logs, which were gathered in `/target/...`:
```
target
   ├── controller-failover-logs
       ├── kafka-broker-3.log
       ├── kafka-broker-4.log
       ├── kafka-controller-0.log
       ├── kafka-controller-1.log
       └── kafka-controller-2.log
```

## Integration with Spring Boot or other platforms

StrimziKafkaCluster works seamlessly with Spring Boot/Quarkus tests as well as we saw above with JUnit5.

## Testing Kafka Connect with StrimziConnectCluster

Beyond Kafka brokers, Strimzi Test Containers also supports **Kafka Connect** testing with `StrimziConnectCluster`.
This allows you to test connectors, transformations, and end-to-end data pipelines in a realistic distributed environment.

### What is StrimziConnectCluster?

`StrimziConnectCluster` creates a Kafka Connect cluster running in **distributed mode** with multiple workers.
It automatically configures:

- Worker-to-worker communication
- Internal topics for offset storage, config storage, and status
- REST API endpoints for managing connectors
- Integration with your Kafka cluster

### Basic Kafka Connect Setup

```java
@Test
void testKafkaConnectCluster() {
    // First, create a Kafka cluster
    StrimziKafkaCluster kafkaCluster = new StrimziKafkaCluster.StrimziKafkaClusterBuilder()
        .withNumberOfBrokers(3)
        .build();
    kafkaCluster.start();

    // Then, create a Connect cluster attached to it
    StrimziConnectCluster connectCluster = new StrimziConnectCluster.StrimziConnectClusterBuilder()
        .withKafkaCluster(kafkaCluster)
        .withNumberOfWorkers(2)
        .withGroupId("test-connect-cluster")
        .build();
    connectCluster.start();

    // Get REST API endpoint
    String restEndpoint = connectCluster.getRestEndpoint();
    System.out.println("Connect REST API: " + restEndpoint);

    // Use the endpoint to deploy connectors...

    connectCluster.stop();
    kafkaCluster.stop();
}
```

**Key components:**

- `.withKafkaCluster()` - Links Connect cluster to Kafka cluster
- `.withNumberOfWorkers(2)` - Creates 2 Connect workers (distributed mode)
- `.withGroupId()` - Sets the Connect cluster group ID
- `.getRestEndpoint()` - Returns the REST API URL (e.g., `http://localhost:8083`)

### Testing File Source and Sink Connectors

StrimziConnectCluster includes built-in file connectors for testing:

```java
@Test
void testFileSourceConnector() throws Exception {
    StrimziKafkaCluster kafkaCluster = new StrimziKafkaCluster.StrimziKafkaClusterBuilder()
        .withNumberOfBrokers(1)
        .build();
    kafkaCluster.start();

    StrimziConnectCluster connectCluster = new StrimziConnectCluster.StrimziConnectClusterBuilder()
        .withKafkaCluster(kafkaCluster)
        .withGroupId("file-test-cluster")
        .build();  // File connectors included by default
    connectCluster.start();

    // Create a source file inside the container
    String sourceFileName = "/tmp/test-source.txt";
    connectCluster.getWorkers().iterator().next()
        .execInContainer("sh", "-c", "echo 'line1\nline2\nline3' > " + sourceFileName);

    // Deploy FileStreamSource connector via REST API
    String restEndpoint = connectCluster.getRestEndpoint();
    String connectorConfig = """
        {
            "name": "file-source",
            "config": {
                "connector.class": "org.apache.kafka.connect.file.FileStreamSourceConnector",
                "tasks.max": "1",
                "file": "%s",
                "topic": "test-topic"
            }
        }
        """.formatted(sourceFileName);

    // POST to /connectors endpoint
    HttpClient client = HttpClient.newHttpClient();
    HttpRequest request = HttpRequest.newBuilder()
        .uri(URI.create(restEndpoint + "/connectors"))
        .header("Content-Type", "application/json")
        .POST(HttpRequest.BodyPublishers.ofString(connectorConfig))
        .build();

    HttpResponse<String> response = client.send(request,
        HttpResponse.BodyHandlers.ofString());
    assertEquals(201, response.statusCode());

    // Verify data arrives in Kafka topic
    Properties consumerProps = new Properties();
    consumerProps.put(ConsumerConfig.BOOTSTRAP_SERVERS_CONFIG,
        kafkaCluster.getBootstrapServers());
    consumerProps.put(ConsumerConfig.GROUP_ID_CONFIG, "test-consumer");
    consumerProps.put(ConsumerConfig.AUTO_OFFSET_RESET_CONFIG, "earliest");
    consumerProps.put(ConsumerConfig.KEY_DESERIALIZER_CLASS_CONFIG,
        StringDeserializer.class.getName());
    consumerProps.put(ConsumerConfig.VALUE_DESERIALIZER_CLASS_CONFIG,
        StringDeserializer.class.getName());

    try (KafkaConsumer<String, String> consumer = new KafkaConsumer<>(consumerProps)) {
        consumer.subscribe(List.of("test-topic"));

        List<String> messages = new ArrayList<>();
        long startTime = System.currentTimeMillis();

        // Poll for messages (with timeout)
        while (messages.size() < 3 && System.currentTimeMillis() - startTime < 10000) {
            ConsumerRecords<String, String> records = consumer.poll(Duration.ofMillis(500));
            records.forEach(record -> messages.add(record.value()));
        }

        assertEquals(3, messages.size());
        assertTrue(messages.contains("line1"));
        assertTrue(messages.contains("line2"));
        assertTrue(messages.contains("line3"));
    }

    connectCluster.stop();
    kafkaCluster.stop();
}
```

### Custom Connector Configuration

Add custom connectors by setting the plugin path:

```java
StrimziConnectCluster connectCluster = new StrimziConnectCluster.StrimziConnectClusterBuilder()
    .withKafkaCluster(kafkaCluster)
    .withNumberOfWorkers(3)
    .withGroupId("custom-connectors")
    .withAdditionalConnectConfiguration(Map.of(
        "plugin.path", "/usr/local/share/kafka/plugins",
        "key.converter", "org.apache.kafka.connect.json.JsonConverter",
        "value.converter", "org.apache.kafka.connect.json.JsonConverter"
    ))
    .withoutFileConnectors()  // Disable default file connectors if not needed
    .build();
```

### Testing Connect Worker Failures

Test distributed Connect behavior when workers fail:

```java
@Test
void testConnectWorkerFailover() throws Exception {
    StrimziKafkaCluster kafkaCluster = new StrimziKafkaCluster.StrimziKafkaClusterBuilder()
        .withNumberOfBrokers(1)
        .build();
    kafkaCluster.start();

    StrimziConnectCluster connectCluster = new StrimziConnectCluster.StrimziConnectClusterBuilder()
        .withKafkaCluster(kafkaCluster)
        .withNumberOfWorkers(3)
        .withGroupId("failover-test")
        .build();
    connectCluster.start();

    // Deploy connector
    // ... (deploy connector code as shown above)

    // Get first worker
    var workers = new ArrayList<>(connectCluster.getWorkers());
    var worker1 = workers.get(0);

    // Stop first worker
    worker1.stop();

    // Verify connector continues running on other workers
    // ... (check connector status via REST API on remaining workers)

    connectCluster.stop();
    kafkaCluster.stop();
}
```

### When to use StrimziConnectCluster?

You can easily use that for testing your custom Kafka Connect connectors.
Moreover, for validation of connector configurations and transformations.
One could also check for connect REST API integrations or even end to end pipeline testing (i.e., source → Kafka → sink)

**A few use cases are**:
- Testing Debezium CDC connectors
- Validating JDBC sink/source connectors
- Testing custom SMTs (Single Message Transforms)
- Verifying connector failure and rebalancing behavior
- Checking your metrics are exported correctly within the Kafka Connect 

## Summary

Strimzi Test Containers provides Kafka testing infrastructure:

**What**: Docker-based multi-node Kafka clusters using Testcontainers framework

**Why**: Real Kafka behavior, automatic lifecycle, proper replication testing, no manual setup

**How**:
- Use `StrimziKafkaCluster` with builder pattern
- Choose combined vs dedicated node roles based on test requirements
- Enable log collection for debugging
- Reuse clusters across tests for performance

**When to use:**
- Testing multi-broker scenarios (replication, leader election)
- Validating consumer group behavior across partitions
- Testing exactly-once semantics with transactions
- Integration testing Kafka Streams applications
- Validating production-like cluster configurations

**When NOT to use:**
- Pure unit tests (use mocks)
- Testing single-partition logic (use single container)
- High-frequency test execution (too slow)

With StrimziKafkaCluster, you can confidently test complex Kafka scenarios (e.g., replication, failover, consumer groups).

---

**Resources:**
- [Strimzi Test Container GitHub](https://github.com/strimzi/test-container)
- [Testcontainers Documentation](https://www.testcontainers.org/)
- [Previous Post: Consumer Groups](/posts/kafka-practical-consumer-groups)
- [Kafka KRaft Mode](https://kafka.apache.org/documentation/#kraft)