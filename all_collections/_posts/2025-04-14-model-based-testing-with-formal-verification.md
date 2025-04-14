---
layout: post
title: "16 🧪 Model-Based Testing: From Spec to Tests with Quint"
date: 2025-04-14
categories: ["formal-verification", "quint", "testing", "mbt"]
---

*What if your specification could write your tests?*

In [Part 15](https://see-quick.github.io/posts/liveness/), we talked about liveness — the idea that "something good eventually happens." 
But proving your model is correct is only one half of the story.
What if your implementation doesn't match your model? 

That’s where Model-Based Testing (MBT) shines.

## Why Model-Based Testing?

You’ve written a formal model — maybe in Quint, TLA+ or any other formal specification language. 
You’ve verified it with model-checkers like Apalache or TLC. 
You know that the model is correct.

But now comes the scary part:
> Does your code behave the same way?

Model-Based Testing gives us a way to check that:
- The implementation conforms to the model
- Every test case is meaningful (because it came from a valid state trace)
- Bugs are easier to reproduce (just follow the trace!)

And because the tests are driven by the model, they automatically cover edge cases and unexpected sequences.

---

## 💡 A Simple Example: The Light Switch

To make this concrete, let’s return to our trusty example — the **Light Switch**, modeled in Quint:
```quint
module LightSwitch {

  var isOn: bool

  // Actions
  action init =
    isOn' = false

  action step = any {
    TurnOn,
    TurnOff
  }

  action TurnOn =
    isOn' = true

  action TurnOff =
    isOn' = false

  // Properties (equivalent to test assertions)
  val LightIsOnAfterTurnOn =
    isOn == true

  val LightIsOffAfterTurnOff =
    isOn == false

  val InitIsOff =
    isOn == false
}
```
Once the model is defined, we can simulate it and extract execution traces — sequences of actions and states the system might go through:
```quint
quint run LightSwitch.qnt --mbt --max-steps 5 --n-traces 20 --out-itf traces.json
```
Each trace gets saved in ITF format, which looks something like this:
```quint
{
  "#meta": {
    "format": "ITF",
    "format-description": "https://apalache-mc.org/docs/adr/015adr-trace.html",
    "source": "LightSwitch.qnt",
    "status": "ok",
    "description": "Created by Quint on Sun Apr 06 2025 00:44:00 GMT+0200 (Central European Summer Time)",
    "timestamp": 1743893040183
  },
  "vars": [
    "isOn",
    "mbt::actionTaken",
    "mbt::nondetPicks"
  ],
  "states": [
    {
      "#meta": {
        "index": 0
      },
      "isOn": false,
      "mbt::actionTaken": "init",
      "mbt::nondetPicks": {}
    },
    {
      "#meta": {
        "index": 1
      },
      "isOn": false,
      "mbt::actionTaken": "TurnOff",
      "mbt::nondetPicks": {}
    },
    {
      "#meta": {
        "index": 2
      },
      "isOn": false,
      "mbt::actionTaken": "TurnOff",
      "mbt::nondetPicks": {}
    },
    {
      "#meta": {
        "index": 3
      },
      "isOn": true,
      "mbt::actionTaken": "TurnOn",
      "mbt::nondetPicks": {}
    },
    {
      "#meta": {
        "index": 4
      },
      "isOn": true,
      "mbt::actionTaken": "TurnOn",
      "mbt::nondetPicks": {}
    },
    {
      "#meta": {
        "index": 5
      },
      "isOn": false,
      "mbt::actionTaken": "TurnOff",
      "mbt::nondetPicks": {}
    }
  ]
}
```
This trace can be interpreted and replayed by a test framework in your language of choice.
Here, we’ll use Java and a simple LightSwitch class:
```java
public class LightSwitch {
  private boolean isOn = false;

  public void turnOn() { isOn = true; }
  public void turnOff() { isOn = false; }
  public boolean isOn() { return isOn; }
}
```
Now we’ll write a [JUnit5](https://junit.org/junit5/docs/current/user-guide/) test that reads the trace and drives the real implementation step-by-step:
```java
// ...
public class LightSwitchTest {

    @JsonIgnoreProperties(ignoreUnknown = true)
    static class Trace {
        public List<Map<String, Object>> states;
    }

    @ParameterizedTest
    @MethodSource("traceProvider")
    public void testTrace(String tracePath) throws Exception {
        runTrace(tracePath);
    }

    // Dynamically provide all JSON trace files from the specified resource directory.
    static Stream<String> traceProvider() {
        try {
            File directory = new File(LightSwitchTest.class.getResource("/traces/lightswitch").toURI());
            return Stream.of(directory.listFiles())
                .filter(file -> file.getName().endsWith(".json"))
                .map(file -> "/traces/lightswitch/" + file.getName());
        } catch (URISyntaxException e) {
            e.printStackTrace();
            return Stream.empty();
        }
    }

    private void runTrace(String tracePath) throws Exception {
        ObjectMapper mapper = new ObjectMapper();
        InputStream input = getClass().getResourceAsStream(tracePath);
        if (input == null) {
            throw new IllegalArgumentException("Trace file not found on classpath: " + tracePath);
        }
        Trace trace = mapper.readValue(input, Trace.class);

        LightSwitch lightSwitch = new LightSwitch();

        for (int i = 0; i < trace.states.size(); i++) {
            Map<String, Object> state = trace.states.get(i);
            String action = (String) state.get("mbt::actionTaken");
            boolean expected = (Boolean) state.get("isOn");

            // Execute action
            if (i > 0) { // skip init (state 0)
                switch (action) {
                    case "TurnOn" -> lightSwitch.turnOn();
                    case "TurnOff" -> lightSwitch.turnOff();
                    case "init" -> {} // already in initial state
                    default -> throw new IllegalArgumentException("Unknown action: " + action);
                }
            }

            // Assert that the state matches
            assertEquals(expected, lightSwitch.isOn(), "Mismatch after step " + i + " (" + action + ")");
        }
    }
}
```
For each trace, we replay the steps and check the state after each action.
If everything aligns, the test passes. 
If not — you know exactly where things went wrong.

This bridges the gap between formal specification and real implementation.
For instance, if you introduce a bug:
```java
    public void turnOff() {
        isOn = true; // <--- 💥 injected bug (setting true instead of false)
    }
```
The generated test suite will catch it immediately — at the exact step where the behavior diverges from the model.

---

Yes, I know what you’re thinking — *“this works for a light switch, but what about real-world systems?”*
Exactly.
LightSwitch is a great toy example, but model-based testing shines even more when applied to complex, stateful components.
In the next post, we’ll explore how to model and test the Strimzi User Operator, a Kubernetes controller that manages Kafka users, secrets, and ACLs.
We’ll show how traces generated from a formal Quint specification can validate reconciliation logic.

## ⚠️ Limitations of Model-Based Testing (with Examples)

While MBT is a powerful approach, it’s important to be aware of its boundaries:
- **It doesn't prove correctness** — MBT explores some paths, not all. 
  - For example, if you only generate 100 traces, you might miss a rare corner case that only occurs on the 101st.
- **You need oracles** — You must define what "correct behavior" looks like in the target system. 
  Without this, a test trace might execute without any checks. 
  - For instance, if the LightSwitch code silently ignores a turnOn() call, the test will pass unless we assert the final state.
- **Handling non-determinism is tricky** — Real-world systems might involve race conditions or network delays. 
  If your model is deterministic but your implementation isn't, replaying a trace might yield different results. 
  - For example, a Kubernetes controller reacting to multiple events may reorder actions unpredictably.
- **Trace interpretation must align with system semantics** — You need glue code that accurately maps model actions to real-world method calls. 
  A mismatch here can cause false positives or negatives.

Still, when used in combination with unit tests, integration tests, and formal proofs, model-based testing can dramatically strengthen confidence in correctness — especially in protocols, state machines, reconciliation loops, and event-driven systems.

---

## 👣 What’s Next?

In this post, we explored the fundamentals of model-based testing using a simple light switch.
But what about more complex, real-world systems?

In the next post, we’ll go deeper by modeling and testing the **Strimzi User Operator** — a Kubernetes controller that manages Kafka users — using Quint.

Let’s go from toggling lights ... to orchestrating real infrastructure. 🚀
