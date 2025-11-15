---
layout: post
title: "29 🔌 Model Context Protocol (MCP): From Concept to Code"
date: 2025-11-15
categories: ["practical", "ai", "mcp", "python"]
---

## Introduction

Imagine connecting your AI assistant to any data source or tool with a simple, standardized protocol—like how USB-C revolutionized device connectivity.
That's exactly what **Model Context Protocol (MCP)** achieves for AI applications.

## What is MCP?

**Model Context Protocol (MCP)** is an open-source standard created by Anthropic that enables AI applications to securely connect to external systems, tools, and data sources. 
Think of it as the "USB-C port for AI applications"—a universal interface that:

- **Standardizes** how AI models access context from various sources
- **Simplifies** integration between AI and external systems
- **Enables** dynamic, contextual AI interactions

### Why MCP Matters

Before MCP, connecting AI to external data required custom integrations for each system:

**Before MCP (N×M Problem):**
```
┌─────────┐      ┌─────────┐      ┌─────────┐
│ Claude  │──────│ Custom  │──────│ GitHub  │
└─────────┘      │ Plugin  │      └─────────┘
                 └─────────┘
┌─────────┐      ┌─────────┐      ┌─────────┐
│ GPT-4   │──────│ Custom  │──────│ Slack   │
└─────────┘      │ Plugin  │      └─────────┘
                 └─────────┘
┌─────────┐      ┌─────────┐      ┌─────────┐
│ Gemini  │──────│ Custom  │──────│Database │
└─────────┘      │ Plugin  │      └─────────┘
                 └─────────┘
   Each AI × Each Data Source = Many Custom Integrations
```

**With MCP (Standardized Protocol):**
```
┌─────────┐                        ┌─────────┐
│ Claude  │──┐                  ┌──│ GitHub  │
└─────────┘  │                  │  └─────────┘
             │   ┌──────────┐   │
┌─────────┐  ├───│   MCP    │───┤  ┌─────────┐
│ GPT-4   │──┤   │ Protocol │   ├──│ Slack   │
└─────────┘  │   └──────────┘   │  └─────────┘
             │                  │
┌─────────┐  │                  │  ┌─────────┐
│ Gemini  │──┘                  └──│Database │
└─────────┘                        └─────────┘
      One Standard Interface = Universal Compatibility
```

**Benefits:**
- **One protocol, many connections**: Write once, use with any MCP-compatible AI client
- **Better AI responses**: AI gets real-time, relevant context
- **Ecosystem growth**: Pre-built MCP servers exist for Google Drive, Slack, GitHub, Postgres, and more

## MCP Architecture

MCP follows a **client-server architecture**:

```
┌─────────────────────────────────────────────────────────┐
│                     MCP Architecture                    │
│                                                         │
│  ┌──────────────┐                    ┌───────────────┐  │
│  │  MCP Client  │◄──────────────────►│  MCP Server   │  │
│  │  (AI App)    │    MCP Protocol    │  (Your Code)  │  │
│  └──────────────┘                    └───────┬───────┘  │
│        │                                     │          │
│        │                                     │          │
│        ▼                                     ▼          │
│  ┌──────────────┐                    ┌───────────────┐  │
│  │   Claude     │                    │  Data Sources │  │
│  │   GPT-4      │                    │  - APIs       │  │
│  │   Gemini     │                    │  - Databases  │  │
│  └──────────────┘                    │  - Files      │  │
│                                      └───────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### Key Primitives

MCP servers expose three types of primitives:

1. **Tools**: Functions the AI can call (e.g., `get_current_weather(city)`, `add(a, b)`)
2. **Resources**: Data the AI can read (e.g., files, database records)
3. **Prompts**: Templates for user interactions (e.g., pre-defined questions)

In this tutorial, we'll focus on **tools** as they provide the most immediate, practical value.

## Prerequisites

Before we begin, ensure you have:
- **Python 3.10+** installed ([download here](https://www.python.org/downloads/))
- **Claude Code CLI** installed ([installation guide](https://code.claude.com/docs/en/installation))
- **uv** or **pip** for package management
- Basic familiarity with Python
- Terminal/command line access

## Building Your First MCP Server

Let's build a practical MCP server that exposes three tools:
1. **add**: Performs addition
2. **get_random_word**: Returns a random inspiring word
3. **get_current_weather**: Fetches live weather data

### Step 1: Install Dependencies

First, install the MCP Python SDK:

**Using uv (recommended)**:
```bash
# Install uv if you haven't already (it's really fast python package and project manager written in rust :))
curl -LsSf https://astral.sh/uv/install.sh | sh

# Install MCP and httpx
uv pip install "mcp[cli]" httpx
```

**Using pip**:
```bash
# Create virtual environment (recommended)
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install "mcp[cli]" httpx
```

**What we installed:**
- `mcp[cli]`: The official MCP Python SDK with CLI tools
- `httpx`: Modern HTTP client for making API requests

### Step 2: Create the MCP Server

Create a file named `server.py`:

```python
"""
MCP Weather Server - A simple Model Context Protocol server
"""

import httpx
import random
from mcp.server.fastmcp import FastMCP

# Create MCP server
mcp = FastMCP("Weather MCP Server")

# List of inspiring words
WORDS = [
    "serendipity", "ephemeral", "luminous", "cascade", "zenith",
    "harmony", "resilience", "innovation", "clarity", "momentum"
]


@mcp.tool()
def add(a: int, b: int) -> int:
    """Add two numbers together.

    Args:
        a: First number
        b: Second number

    Returns:
        The sum of a and b
    """
    return a + b


@mcp.tool()
def get_random_word() -> str:
    """Get a random inspiring word from a predefined list.

    Returns:
        A random inspiring word
    """
    return random.choice(WORDS)


@mcp.tool()
def get_current_weather(city: str) -> str:
    """Get current weather information for a specified city.

    Args:
        city: Name of the city (e.g., 'London', 'New York', 'Prague')

    Returns:
        Weather information as a formatted string
    """
    try:
        # Using wttr.in - a free weather API
        response = httpx.get(
            f"https://wttr.in/{city}",
            params={"format": "3"},  # Concise format
            timeout=10.0
        )
        response.raise_for_status()
        return response.text
    except httpx.HTTPError as e:
        return f"Error fetching weather data: {str(e)}"


# Entry point for running the server
if __name__ == "__main__":
    mcp.run()
```

**Key Points:**
- `@mcp.tool()` decorator registers functions as MCP tools
- Type hints and docstrings are crucial—they tell the AI how to use your tools
- The entry point `if __name__ == "__main__": mcp.run()` is required

## Testing Your MCP Server

### Adding Your Server to Claude Code CLI

Use the `claude mcp add` command to register your server:

```bash
# Navigate to your project directory first
cd /path/to/your/project

# Add the server with an absolute path to server.py
claude mcp add weather python3 /absolute/path/to/server.py
```

**Important**: Use **absolute paths** for the server.py file.

### Verifying Your Server

Check that your server was added successfully:

```bash
# List all MCP servers
claude mcp list
```

You should see output like:

```
weather - ✓ Connected
  Command: python3 /absolute/path/to/server.py
  Tools: add, get_random_word, get_current_weather
```

### Using Your Tools

Now you can use your MCP server tools in any Claude Code conversation:

```bash
# Start Claude Code
claude

# Then ask questions that use your tools:
# "What's the weather in Prague?"
# "Add 42 and 58"
# "Give me a random word"
```

Claude Code will automatically call your MCP server tools when relevant.

To remove a server: `claude mcp remove weather`

## Extending Your Server

As we currently have very easy MCP running, one can image that you can extend it to do more than just adding or get random a word.
For instance, you could implement MCP for:
1. **querying database** (e.g., SQLLite, PostgresSQL)
2. reading / writing to files => file operations
3. **REST API integration** such as fetch open GitHub issues for you specific use-case

Moreover, we could design domain-specific MCP servers for the best results for different contexts:
1. Documentation server, which would write technical content (i.e., we would use `@mcp_docs.resource("book://"`, and other important resources to make such documentation very great)
2. Development server, which would write coding stuff (i.e., search primarily in concrete domains such as stackoverflow...)

and many more. 
One may ask why use separate servers. 
The answer on such question is that we 
(i.) improve security i.e., we limit server's access to only what is needs; 
(ii.) context relevance i.e., we only use documentation sources when writing and dev tools only when coding; 
(iii.) performance-vise i.e., smaller, focused servers are typically faster and easier to debug

## Conclusion

In this blog post, we have a built a working MCP server in approximately 60 LOC.
We have learned (i.) MCP's client-server architecture; (ii.) Creating tools with `@mcp.tool()` decorators;
and (iii.) Integrating with Claude Code CLI.

### Resources

- [Official MCP Documentation](https://modelcontextprotocol.io)
- [MCP Python SDK](https://github.com/modelcontextprotocol/python-sdk)
- [MCP Specification](https://spec.modelcontextprotocol.io)
- [Example Servers](https://github.com/modelcontextprotocol/servers)
- [MCP Community](https://github.com/modelcontextprotocol)

Happy building!