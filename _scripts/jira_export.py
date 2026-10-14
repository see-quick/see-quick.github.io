#!/usr/bin/env python3
"""Exports Apache KAFKA Jira issues for the /kafka-jira/ dashboard.

Writes assets/data/kafka-jira/{open_issues,flow,meta}.json. Uses the public,
anonymous Jira REST search API; curl instead of urllib so it works with the
system certificate store on macOS too.
"""
import datetime
import json
import os
import subprocess
import sys
import urllib.parse

API = "https://issues.apache.org/jira/rest/api/2/search?"
OUT = os.path.join(os.path.dirname(__file__), "..", "assets", "data", "kafka-jira")


def search(jql, fields):
    issues, start = [], 0
    while True:
        query = urllib.parse.urlencode({"jql": jql, "fields": fields, "startAt": start, "maxResults": 1000})
        raw = subprocess.run(["curl", "-sSf", "--retry", "3", "--max-time", "180", API + query],
                             capture_output=True, check=True).stdout
        page = json.loads(raw)
        issues += page["issues"]
        start += len(page["issues"])
        print(f"{jql[:50]}... {start}/{page['total']}", file=sys.stderr)
        if not page["issues"] or start >= page["total"]:
            return issues


def components(fields):
    return ", ".join(sorted(c["name"].strip() for c in fields["components"])) or "(none)"


def write(name, data):
    with open(os.path.join(OUT, name), "w") as f:
        json.dump(data, f, separators=(",", ":"))


def main():
    os.makedirs(OUT, exist_ok=True)
    open_issues = [{
        "key": i["key"],
        "summary": i["fields"]["summary"],
        "type": i["fields"]["issuetype"]["name"],
        "status": i["fields"]["status"]["name"],
        "priority": (i["fields"]["priority"] or {}).get("name", ""),
        "components": components(i["fields"]),
        "labels": ", ".join(i["fields"]["labels"]),
        "assigned": i["fields"]["assignee"] is not None,
        "created": i["fields"]["created"][:10],
        "updated": i["fields"]["updated"][:10],
    } for i in search("project = KAFKA AND resolution = Unresolved ORDER BY key DESC",
                      "summary,issuetype,status,priority,components,assignee,created,updated,labels")]
    flow = [{
        "key": i["key"],
        "components": components(i["fields"]),
        "created": i["fields"]["created"][:10],
        "resolved": (i["fields"]["resolutiondate"] or "")[:10],
    } for i in search("project = KAFKA AND (created >= -730d OR resolved >= -730d) ORDER BY key DESC",
                      "components,created,resolutiondate")]
    write("open_issues.json", open_issues)
    write("flow.json", flow)
    write("meta.json", {"generatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="minutes"),
                        "openIssues": len(open_issues), "flowIssues": len(flow)})


if __name__ == "__main__":
    main()
