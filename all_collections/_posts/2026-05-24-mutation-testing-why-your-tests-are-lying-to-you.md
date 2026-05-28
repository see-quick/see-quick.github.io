---
layout: post
title: "38 Mutation Testing: Why Your Tests Are Lying to You"
date: 2026-05-24
categories: ["java", "testing", "practical"]
quiz: mutation-testing
---

Here is a test with 100% code coverage. It catches exactly zero bugs.

Look at this code:

```java
public boolean isEligible(int age) {
    return age >= 18;
}

@Test
void testIsEligible() {
    isEligible(25);
}
```

Line coverage: **100%**. Ship it.

Now change `age >= 18` to `age >= 99`. The test still passes.
Change `return age >= 18` to `return false`. The test still passes.
Delete the entire method body and return `true`. The test *still passes*.

The test calls the code. It never checks the result. Your coverage tool cannot tell the difference.

This is not a contrived example. This pattern is everywhere: tests that *execute* code without *verifying* behavior. Code coverage measures execution, not verification. It is like reading every page of a book but not remembering a single word.

This is where **mutation testing** enters the picture.

---

## What Is Mutation Testing?

Mutation testing is a technique that asks a simple but brutal question: **if I introduce a bug into your code, will your tests catch it?**

### Formal Definition

A mutation testing system is a four-tuple:

$$
(P,\ T,\ M,\ O)
$$

where:

- $P$ is the original program under test.
- $T = \lbrace t_1, t_2, \ldots, t_n \rbrace$ is the test suite.
- $M$ is a set of **mutation operators**. Each operator $m \in M$ transforms the original program into a set of mutants: $m(P) = P'_1, P'_2, \ldots, P'_k $
- $O$ is the **oracle**: the pass/fail outcome of running $T$ against each mutant.

A mutant $P^\prime$ is **killed** if at least one test detects it:

$$
\exists\ t \in T : O(t, P^\prime) \neq O(t, P)
$$

If no test detects the change, the mutant **survived**.

The **mutation score** is then the ratio of killed mutants to total mutants:

$$
MS(P, T) = \frac{| \lbrace P^\prime \in M(P) : P^\prime \text{ is killed} \rbrace |}{| M(P) |}
$$

In plain terms: a mutation testing tool takes your source code and creates **mutants**, slightly modified copies where each one has exactly one small change. It then runs your test suite against every mutant. If a test fails, the mutant is killed (your tests caught the bug). If all tests still pass, the mutant survived, and you have a blind spot.

Your mutation score is the percentage of mutants killed out of the total generated. Think of it as a *quality audit* of your test suite rather than a quantity metric.

### Types of Mutations

The mutations are small and realistic, exactly the kind of mistakes a developer might make during a late-night refactor:

| Mutation Type | Original | Mutated |
|---------------|----------|---------|
| Conditional boundary | `if (a > b)` | `if (a >= b)` |
| Negated conditional | `if (a == b)` | `if (a != b)` |
| Return value | `return true` | `return false` |
| Math operator | `a + b` | `a - b` |
| Void method call | `config.enableSsl()` | *(removed entirely)* |

Each mutation is applied **one at a time** - the tool creates hundreds of single-change variants and checks each independently.

### The Flow

```
Source Code            Mutant                     Test Suite
┌─────────────┐      ┌─────────────┐            ┌──────────┐
│ if (a > b)  │ ──►  │ if (a >= b) │ ──► Run ──►│  Tests   │
└─────────────┘      └─────────────┘            └────┬─────┘
                                                     │
                                              ┌──────┴──────┐
                                              │             │
                                         Test FAILS    Test PASSES
                                         (Mutant       (Mutant
                                          Killed ✓)     Survived ✗)
```

### Code Coverage vs Mutation Score

Here is the key difference at a glance:

| | Code Coverage | Mutation Score |
|---|---|---|
| **Measures** | Lines/branches executed | Whether tests detect changes |
| **Assertion-free test** | Increases coverage | Exposed as surviving mutant |
| **False confidence** | High | Low |
| **Cost** | Fast | Slower (runs suite per mutant) |
| **Question it answers** | "Was this code reached?" | "Would my tests catch a bug here?" |

Coverage counts footsteps. Mutation score checks whether anyone was actually paying attention.

{% include quiz.html id="q1" %}

---

## Why You Should Care

Code coverage answers the wrong question. You do not care whether your tests *touched* a line - you care whether they would *scream* if that line broke.

Let me show you three patterns where 100% coverage means absolutely nothing.

### The Silent Assertion Gap

```java
public int calculateDiscount(int price, int quantity) {
    if (quantity > 10) {
        return price * 20 / 100;
    }
    return 0;
}

@Test
void testDiscount() {
    int result = calculateDiscount(100, 15);
    // 100% coverage! But...
    assertNotNull(result);
}
```

Coverage report: **100%**. Every branch hit. Every line executed.

But a mutation tester/framework would generate these mutants - and *every single one survives* (which is bad, if that's what you are asking :D):

| Mutation | Survives? | Why |
|----------|-----------|-----|
| `quantity > 10` → `quantity >= 10` | ✓ Survives | Test uses 15, never tests boundary |
| `price * 20` → `price * 0` | ✓ Survives | `assertNotNull` on a primitive int always passes |
| `return 0` → `return 1` | ✓ Survives | The else branch result is never checked either |

The test *runs* the code. It does not *verify* it. `assertNotNull` on a primitive int is essentially a no-op - it will never be null.

### The Boundary Blindness

```java
public void validateWorkerCount(int workers) {
    if (workers <= 0) {
        throw new IllegalArgumentException("Workers must be positive");
    }
}

@Test
void testValidation() {
    assertThrows(IllegalArgumentException.class,
        () -> validateWorkerCount(-1));
}
```

Both branches covered. But mutate `workers <= 0` to `workers < 0` - the test *still passes* because it only tests `-1`, never `0`. The boundary value is completely unchecked.

A mutation tester would flag this surviving mutant, and the fix is trivial - add one more test:

```java
@Test
void testValidationAtBoundary() {
    assertThrows(IllegalArgumentException.class,
        () -> validateWorkerCount(0));
}
```

One extra line. One real bug prevented.

{% include quiz.html id="q2" %}

### The Void Method Trap

```java
public void configureServer(ServerConfig config) {
    config.setPort(9092);
    config.enableSsl();
    config.setMaxConnections(100);
}

@Test
void testConfigureServer() {
    ServerConfig config = new ServerConfig();
    configureServer(config);
    // "it didn't throw, so it works!"
}
```

A mutation tester can *remove* any of those three method calls entirely. The test still passes - it only checks that the method does not throw an exception. All three removals are surviving mutants.

The fix? Actually verify the state:

```java
@Test
void testConfigureServer() {
    ServerConfig config = new ServerConfig();
    configureServer(config);
    assertEquals(9092, config.getPort());
    assertTrue(config.isSslEnabled());
    assertEquals(100, config.getMaxConnections());
}
```

### The Pattern

All three examples share the same flaw: tests that *execute* code without *asserting on behavior*. Coverage tools cannot tell the difference. Mutation testing can.

Coverage is the speedometer. Mutation score tells you whether you are actually moving.

---

Your tests might be running. But are they *testing*? Find out.

{% include quiz.html id="q3" %}
