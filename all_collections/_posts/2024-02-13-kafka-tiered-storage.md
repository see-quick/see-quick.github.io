---
layout: post
title: "2 Scaling Horizons: Embracing Tiered Storage in Apache Kafka for Optimal Efficiency and Cost Savings"
date: 2024-02-13
categories: ["apache-kafka", "tiered-storage", "IT", "distributed-system"]
---

Tiered storage ([KIP-405](https://cwiki.apache.org/confluence/display/KAFKA/KIP-405%3A+Kafka+Tiered+Storage)) in Apache Kafka 
is a feature that allows Kafka to store a larger amount of data than would normally fit on the local disk by extending 
the storage onto cheaper, slower storage systems like AWS S3, Google Cloud Storage, or Hadoop Distributed File System (HDFS). 
This is particularly useful for use cases requiring long-term retention of data for compliance, analysis, or other 
purposes without the need for high-performance disk storage across the entire dataset.

## How Tiered Storage Works

Tiered storage works by segregating storage into different tiers:
1. **Hot Storage (Tier 1):** High-speed, expensive storage (like SSDs) that is directly attached to the Kafka brokers. 
This is used for storing recent or frequently accessed data.
2. **Cold Storage (Tier 2):** Slower, cheaper storage options like object storage services (S3, GCS) or HDFS. 
This is used for less frequently accessed data. 
When messages are produced to Kafka, they first land in the hot storage for quick access. 
Over time, as data ages or based on certain policies (like size thresholds or time), older data is offloaded to the cold storage tier. 
Despite being offloaded, the data remains accessible to Kafka clients; Kafka transparently manages access to data across these tiers.

## A Cost-Efficiency example 

Imagine a Kafka cluster that handles log data from various services. 
The requirement is to retain this data for two years for compliance and analysis purposes. 
The average daily data volume is 100GB. We'll compare costs and efficiency in two setups:
1. **Traditional Storage Setup:** All data is stored on high-performance SSDs attached to the Kafka brokers.
2. **Tiered Storage Setup:** Recent data (last 30 days) is stored on SSDs (hot tier), and older data is offloaded to an object storage service like Amazon S3 (cold tier).

---

### Benefits and Comparison: SSD vs. S3 in Apache Kafka Tiered Storage

#### Key Parameters and Assumptions

| Parameter                   | Description                                        |
|-----------------------------|----------------------------------------------------|
| **SSD Cost**                | $0.10 per GB per month                             |
| **S3 Cost**                 | $0.023 per GB per month (Standard Storage)         |
| **Daily Data Volume**       | 100GB                                              |
| **Retention Period**        | 2 years                                            |

#### Data Volume Calculation

| Storage Type          | Calculation                         | Total Data Volume |
|-----------------------|-------------------------------------|-------------------|
| **Traditional (SSD)** | 100GB/day * 365 days/year * 2 years | 73,000GB          |
| **Tiered (SSD Hot)**  | 100GB/day * 30 days                 | 3,000GB           |
| **Tiered (S3 Cold)**  | 73,000GB - 3,000GB                  | 70,000GB          |

#### Cost Calculation

| Storage Setup             | Calculation                                                         | Total Cost Over 2 Years |
|---------------------------|---------------------------------------------------------------------|-------------------------|
| **Traditional (SSD)**     | 73,000GB * $0.10/GB/month * 24 months                               | $175,200                |
| **Tiered (SSD + S3)**     | (3,000GB * $0.10/GB/month + 70,000GB * $0.023/GB/month) * 24 months | $83,280                 |

#### Benefits Summary

| Benefit                    | Traditional Storage (SSD)                           | Tiered Storage (SSD + S3)                                         |
|----------------------------|-----------------------------------------------------|-------------------------------------------------------------------|
| **Cost Efficiency**        | Lower due to high cost of SSD storage for all data. | Higher due to leveraging lower-cost S3 storage for older data.    |
| **Scalability**            | Limited by physical SSD storage capacity.           | Enhanced by offloading data to scalable cloud storage.            |
| **Data Retention**         | Limited by cost and capacity.                       | Facilitated by cost-effective long-term storage in S3.            |
| **Access Time**            | Fast access to all data.                            | Fast access to recent data; slower access to cold data in S3.     |
| **Operational Complexity** | Simpler, with all data on SSDs.                     | More complex due to managing data across different storage tiers. |

This table highlights the trade-offs between using traditional SSD storage only and adopting a tiered storage approach 
with both SSDs and S3 in an Apache Kafka environment. 
While tiered storage introduces some complexity, it offers significant advantages in terms of cost savings, scalability, 
and data retention capabilities.

Tiered storage in Apache Kafka marks a significant leap towards cost-effective and scalable data management. 
By combining fast, local storage with affordable cloud storage, Kafka users can now enjoy extended data retention and 
improved cluster scalability without compromising on performance. 
This strategic approach not only reduces costs but also aligns with the growing demand for efficient, large-scale data 
processing and storage solutions. Embracing tiered storage thus represents a forward-thinking move for organizations 
aiming to optimize their data infrastructure for the future.

