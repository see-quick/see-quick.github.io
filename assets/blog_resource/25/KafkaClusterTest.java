package io.strimzi.test.container;

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
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.UUID;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;

import static org.hamcrest.CoreMatchers.is;
import static org.hamcrest.MatcherAssert.assertThat;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class KafkaClusterTest {

    private static StrimziKafkaCluster kafkaCluster;

    @AfterAll
    static void teardown() {
        kafkaCluster.stop();
    }

    @Test
    void testClusterHasThreeNodes() throws ExecutionException, InterruptedException {
        kafkaCluster = new StrimziKafkaCluster.StrimziKafkaClusterBuilder()
            .withNumberOfBrokers(3)
            .withInternalTopicReplicationFactor(3)
            .withSharedNetwork()
            .build();
        kafkaCluster.start();

        try (AdminClient admin = AdminClient.create(Map.of(
            AdminClientConfig.BOOTSTRAP_SERVERS_CONFIG,
            kafkaCluster.getBootstrapServers()))) {

            var nodes = admin.describeCluster().nodes().get();
            assertEquals(3, nodes.size(), "Cluster should have 3 nodes");
        }
    }

    @Test
    void testProduceToReplicatedTopic() throws Exception {
        kafkaCluster = new StrimziKafkaCluster.StrimziKafkaClusterBuilder()
            .withNumberOfBrokers(3)
            .withInternalTopicReplicationFactor(3)
            .withSharedNetwork()
            .build();
        kafkaCluster.start();

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

    @Test
    void testLeaderElectionAfterBrokerFailure() throws Exception {
        kafkaCluster = new StrimziKafkaCluster.StrimziKafkaClusterBuilder()
            .withNumberOfBrokers(3)
            .withInternalTopicReplicationFactor(3)
            .withSharedNetwork()
            .build();
        kafkaCluster.start();

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
            StrimziKafkaContainer leaderBroker = (StrimziKafkaContainer) brokers.stream()
                .filter(b -> ((StrimziKafkaContainer) b).getBrokerId() == initialLeader)
                .findFirst()
                .orElseThrow(() -> new IllegalStateException("Could not find broker with ID " + initialLeader));
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


    @Test
    void testConsumerGroupRebalancingInCluster() throws Exception {
        kafkaCluster = new StrimziKafkaCluster.StrimziKafkaClusterBuilder()
            .withNumberOfBrokers(3)
            .withInternalTopicReplicationFactor(3)
            .withSharedNetwork()
            .build();
        kafkaCluster.start();

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
}