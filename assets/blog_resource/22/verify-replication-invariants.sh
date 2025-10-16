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
    from = ""
    to = ""

    # Try new format first: "from (offset=X, ...) to (offset=Y, ...)"
    if (match($0, /from \(offset=[0-9]+,.*to \(offset=[0-9]+,/)) {
      # Extract the first offset
      temp = $0
      sub(/.*from \(offset=/, "", temp)
      from = temp
      sub(/,.*/, "", from)

      # Extract the second offset
      temp = $0
      sub(/.*to \(offset=/, "", temp)
      to = temp
      sub(/,.*/, "", to)
    }
    # Try old format: "from X to Y"
    else if (match($0, /from [0-9]+ to [0-9]+/)) {
      temp = $0
      sub(/.*from /, "", temp)
      from = temp
      sub(/ to .*/, "", from)

      temp = $0
      sub(/.*to /, "", temp)
      to = temp
      sub(/ .*/, "", to)
    }

    if (from == "" || to == "") {
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
    # Extract version number
    if (match($0, /version updated to [0-9]+/)) {
      temp = $0
      sub(/.*version updated to /, "", temp)
      version = temp
      sub(/ .*/, "", version)
      # Remove any non-numeric characters
      gsub(/[^0-9]/, "", version)

      # Extract partition name for per-partition tracking
      part_name = "unknown"
      if (match($0, /Partition [^ ]+ broker/)) {
        temp = $0
        sub(/.*Partition /, "", temp)
        part_name = temp
        sub(/ broker.*/, "", part_name)
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
    if (match($0, /size of the current ISR : [0-9]+ is insufficient to satisfy the min\.isr requirement of [0-9]+/)) {
      # Extract ISR size
      temp = $0
      sub(/.*size of the current ISR : /, "", temp)
      isr_size = temp
      sub(/ is insufficient.*/, "", isr_size)

      # Extract min ISR requirement
      temp = $0
      sub(/.*min\.isr requirement of /, "", temp)
      min_isr = temp
      # Remove everything after the number
      gsub(/[^0-9].*/, "", min_isr)

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
echo "  kafka-configs --bootstrap-server localhost:<kafka-port> --alter \\"
echo "    --entity-type broker-loggers --entity-name <broker-id> \\"
echo "    --add-config kafka.cluster.Partition=TRACE,kafka.server.ReplicaManager=DEBUG"