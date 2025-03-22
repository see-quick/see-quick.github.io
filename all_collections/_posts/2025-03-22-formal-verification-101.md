---
layout: post
title: "13 🐞 Formal Verification 101: What, Why, and How"
date: 2025-03-22
categories: ["formal-verification", "model-checking", "specifications"]
---

*It starts with a bug.*

Not a crash-during-demo kind of bug — but the sneaky kind. One that only shows up after months in production, under just the right conditions. 
A race condition. 
A lost message. 
A deadlock. 
The kind that slips through tests and code reviews unnoticed.

That’s where **formal verification** comes in — not to catch bugs after they happen, but to *prove* they can’t happen at all.

---

## 🔍 What is Formal Verification?

Formal verification is the use of **mathematics** to prove that a system behaves correctly — under *all* possible conditions. Unlike tests (which check specific cases), formal methods explore every path, every input, every interleaving. Let’s break that down with an example. Imagine you’re building a simple mutex — a lock that ensures only one thread can enter a critical section at a time.

### **What’s involved?**

**1. Specifying the system’s behavior** - You define the rules the system should follow. 
For example: “At any moment, at most one thread may be in the critical section.”

**2. Modeling how it works** - You describe the system in terms of *states* and *transitions*. 
For instance:
- State A: No threads in the critical section
- State B: Thread 1 enters
- State C: Thread 2 enters  

You model how the system moves between these states, depending on actions like “request lock” or “release lock.”

**3. Checking or proving properties** - You write down the properties that should *always* be true — for instance:  
```el
Thread1.inCriticalSection and Thread2.inCriticalSection ⇒ false
// (In plain English: both threads must never be in the critical section at the same time.)  
```  
Then you have to choose **model checker**. Think of it like this:
1. You give it your system’s model — like a simplified version of your program. (in our case two threads with critical section)
2. You give it properties you want to check — like “this state should never happen.” (in our case both threads must never be in critical section)
3. It runs through every possible combination of actions and states — even the weird edge cases you didn’t think of — and tells you if the property ever breaks.

If the model checker finds a problem, it doesn’t just say “something went wrong” — it shows you exactly how to reproduce it. 
That’s like getting a bug report with a built-in minimal test case.

Tools like [TLA+](https://lamport.azurewebsites.net/tla/tla.html), [Alloy](https://alloytools.org/) are popular model checkers used by NASA, Amazon, Intel, and others to catch design bugs before writing any code.

## ❓ Why Use Formal Verification?

Because some bugs don’t forgive.

You can write tests. 
You can write lots of tests.
But when your system runs across threads, nodes, networks, or time — the number of possible states explodes beyond what tests can cover.
At that scale, bugs hide in the cracks between components. 
They appear only after rare interleavings, failover races, or concurrency hiccups. 
And when they do, they break things you thought were impossible

In critical systems — aerospace, finance, healthcare, distributed databases — a single edge-case failure can mean millions lost, or worse. 
Formal verification helps you prove things like:
- “This lock will never be acquired by two threads at once”
- “This system will never deadlock”
- “This file will always be replicated to at least 3 servers
- “Two leaders can never be elected at the same time in Raft”)
- “No tokens are lost or created without authorization in an ERC20 transfer” 
- “Eventually, every message sent will be either delivered or explicitly failed”
- and many more...

It doesn’t just help you find bugs — it helps you avoid writing them in the first place, by making your designs precise and checkable.
It’s about confidence — not just that your code *probably* works, but that it *must*.

And yes, it’s used in the real world:
- **Amazon** uses TLA+ to catch design flaws before writing a single line of code
- **Intel** uses formal methods to validate CPU designs
- **NASA** used it to verify flight software

It’s not magic. But it’s close.

## 🛠️ How Does It Work?

At its core, formal verification means writing a precise model of your system — and then using tools to explore every possible state it could reach.

You describe:
- The rules of your system: how state changes over time
- The environment: things like network delays, restarts, retries
- The invariants you want to guarantee — like “no two leaders at once” or “balance never goes negative”

Then you run a model checker — a tool that simulates every possible execution path, including the weird edge cases you’d never think to test.
If your rule doesn’t hold, the tool gives you a counterexample: a minimal sequence of steps that leads to failure.

This lets you:
- Catch bugs before writing code
- Spot flaws in your design (not just implementation)
- Explore “what if” scenarios quickly, like changing timeouts, retry logic, or failover behavior

And the tools are more approachable than you think.

Popular tools include:
- [TLA+](https://github.com/tlaplus) — for distributed systems and concurrency
- [Alloy](https://alloytools.org/) — great for modeling state and relations
- [Quint](https://github.com/informalsystems/quint) — a modern language for specifying and checking system behavior (e.g. Raft, ERC20). 
It's transpiler to TLA+ but it's syntax it's really handy and can use Apalache/TLC model checkers as backend.
- [Coq](https://github.com/coq/coq) — proof assistant for math-heavy verification
- [Storm](https://github.com/moves-rwth/storm) —  A Modern Probabilistic Model Checker

## 💡 A Tiny Example in Quint

Let’s model a very simple system: a light switch. 

We’ll use Quint — a specification language that’s expressive, beginner-friendly, and designed for modeling system behavior. 
It looks a bit like pseudocode, but with formal semantics underneath.
In our case, we want to:
1.	Allow the light to be turned on or off
2.	Ensure the light is never in an undefined state
3.	Prevent any contradictory states (like being on and not-on at the same time)

There are many more properties we could check — like liveness or fairness — but we’ll stick to safety properties for now. 
These are simpler and focus on “nothing bad ever happens” rather than “something good eventually happens.”

```quint
module LightSwitch {

  // The state of the light: true = on, false = off
  var isOn: bool
  
   // Initial state: light is off
  action init = all { isOn' = false }

  // Action to turn the light on
  action turnOn = all {
    isOn' = true  // Light becomes on
  }
  
  // Action to turn the light off
  action turnOff = all {
    isOn' = false // Light becomes off
  }
  
  // Define step relation (light can be turned on or off)
  action step = any {
    turnOn,
    turnOff
  }
  
  // SAFETY PROPERTIES
  // 1. The light is always defined (i.e. never undefined)
  val LightDefined = isOn or isOn == false

  // 2. The light is never both on and not on (basic sanity check)
  val NotContradictory = not (isOn and not(isOn))
```

Simply then we can run `Quint` as 
```bash
quint run light_switch-spec.qnt --invariant=LightDefined
```
and it would basically show us one possible path within simulation 
```
$ quint run ls.qnt --invariant=LightDefined --max-steps 100
An example execution:

[State 0] { isOn: false }
[State 1] { isOn: true }
[State 2] { isOn: true }
[State 3] { isOn: true }
[State 4] { isOn: false }
[State 5] { isOn: false }
...
[State 96] { isOn: true }
[State 97] { isOn: false }
[State 98] { isOn: false }
[State 99] { isOn: false }
[State 100] { isOn: false }

[ok] No violation found (2588ms).
You may increase --max-samples and --max-steps.
Use --verbosity to produce more (or less) output.
Use --seed=0x9ff5152767ad9 to reproduce.
```
If we want to explore whole state space we can run one of the model checkers, which Quint supports (i.e.,
[Apalache](https://github.com/apalache-mc/apalache)) using:
```el
$ quint verify ls.qnt --invariant=LightDefined
...
PASS #8: VCGen                                                    I@14:39:23.844
  > Producing verification conditions from the invariant q::inv   I@14:39:23.844
  > VCGen produced 1 verification condition(s)                    I@14:39:23.846
...
State 0: Checking 1 state invariants                              I@14:39:24.426
State 0: state invariant 0 holds.                                 I@14:39:24.431
...
State 10: Checking 1 state invariants                             I@14:39:24.466
State 10: state invariant 0 holds.                                I@14:39:24.467
State 10: Checking 1 state invariants                             I@14:39:24.467
State 10: state invariant 0 holds.                                I@14:39:24.467
Step 10: picking a transition out of 2 transition(s)              I@14:39:24.468
The outcome is: NoError                                           I@14:39:24.470
[ok] No violation found (2236ms).
```
That means that invariant LightDefined holds in all states. 
  
## 🚦 When *Not* to Use It

Not every project needs formal verification.

If you’re building a blog (like this one!), unit tests are probably enough. 
But if you're building **protocols, distributed systems, safety-critical logic**, or anything where correctness matters deeply — formal methods might be your best friend.

## 👣 What’s Next?

In this post, we scratched the surface of what formal verification is, why it matters, and how to get started — even with a tiny model like a light switch.
But there’s more.
In the next post, we’ll go deeper into the three core types of properties we can check in systems:
1. Safety — “Nothing bad ever happens”
2. Liveness — “Something good eventually happens”
3. Fairness — “If something is always possible, it will eventually happen”
   
Stay tuned. It only gets more interesting from here. 🙂