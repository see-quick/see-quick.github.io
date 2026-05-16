---
layout: post
title: "36 Computability Theory Part 5: From Computability to Complexity"
date: 2026-05-15
categories: ["theory-of-computation", "automata", "formal-languages", "java"]
quiz: computability-part-5
---

*You proved your problem is decidable. Congratulations.
Now the bad news: the algorithm takes longer than the age of the universe.*

In [Part 1](/posts/computability-theory-part-1-regular-languages), we matched patterns.
In [Part 2](/posts/computability-theory-part-2-context-free-languages), we parsed nested structures.
In [Part 3](/posts/computability-theory-part-3-context-sensitive-languages), we checked cross-references.
In [Part 4](/posts/computability-theory-part-4-turing-machines-and-the-hardest-problems), we hit the wall: some problems are **impossible**.
Now we zoom in on the decidable problems and discover that **possible** does not mean **practical**.

---

## The Shift: Computability vs Complexity

Parts 1-4 used the Turing machine to answer one question: **can** this problem be solved?
Now we keep the same machine but add a clock: **how fast** can it be solved?

These are orthogonal concerns:

| Question                  | Field         | Cares about...              |
|---------------------------|---------------|-----------------------------|
| Can we solve it?          | Computability | Whether any TM decides it   |
| How fast can we solve it? | Complexity    | How many steps the TM needs |

Computability gave us a clean split: decidable, semi-decidable, undecidable.
Complexity takes the decidable problems and splits them further, by how the number of steps grows with the input size.

A problem that takes $O(n^2)$ steps is very different from one that takes $O(2^n)$ steps, even though both are decidable.
The first is practical.
The second is a ticking bomb.

{% include quiz.html id="q1" %}

---

## Complexity Classes

Here are the big ones:

**P** (Polynomial Time): Problems solvable in $O(n^k)$ steps for some constant $k$.
Sorting, searching, shortest path, regex matching.
These are the "easy" problems.

**NP** (Nondeterministic Polynomial Time): Problems where a proposed solution can be **verified** in polynomial time.
You might not know how to *find* the answer fast, but if someone hands you a candidate, you can *check* it fast.

**PSPACE** (Polynomial Space): Problems solvable using polynomial memory, regardless of time.
This includes everything in NP but also things like: "does player 1 have a winning strategy in this game?"

**EXPTIME** (Exponential Time): Problems requiring $O(2^{n^k})$ steps.
Some board games (generalized chess) live here.

They nest like this:

$$P \subseteq NP \subseteq PSPACE \subseteq EXPTIME \subseteq \text{Decidable}$$

![Complexity classes as concentric rings: P inside NP inside PSPACE inside EXPTIME inside Decidable](/assets/images/36/complexity-classes.svg)

We know $P \neq EXPTIME$. But whether $P = NP$ is the biggest open question in computer science, worth a [$1 million prize](https://www.claymath.org/millennium-problems/).

{% include quiz.html id="q2" %}

---

## NP-Completeness

Some NP problems are **the hardest** problems in NP.
These are called **NP-complete**: if you could solve any one of them in polynomial time, you would solve **all** of NP in polynomial time (and prove $P = NP$).

Stephen Cook (1971) and Leonid Levin (1973) proved that **SAT** (Boolean Satisfiability) is NP-complete.
Richard Karp (1972) then showed 21 other problems are NP-complete by **reducing** them from SAT, the same reduction technique from Part 4, but now preserving polynomial time rather than decidability.

Today thousands of problems are known to be NP-complete.
If anyone solves *one* of them efficiently, all of them fall.
Nobody has, in over 50 years.

---

## The Knapsack Problem

Here is one of those NP-complete problems, and it is something every engineer has faced intuitively.

> You have a backpack with weight capacity $W$.
> There are $n$ items, each with a weight and a value.
> Pick items to **maximize total value** without exceeding the weight limit.

| Item    | Weight | Value |
|---------|--------|-------|
| Laptop  | 3      | 4     |
| Camera  | 2      | 3     |
| Book    | 1      | 1     |
| Jacket  | 2      | 2     |

With capacity $W = 4$: the best choice is Laptop + Book (weight 4, value 5).

Simple enough for 4 items.
But with $n$ items, there are $2^n$ possible subsets to check.
With 50 items, that is over **one quadrillion** subsets.

{% include quiz.html id="q3" %}

---

## Java: Brute Force

The honest approach: try every subset.

```java
public class KnapsackBruteForce {

    public static int solve(int[] weights, int[] values, int capacity) {
        int n = weights.length;
        int best = 0;

        for (int mask = 0; mask < (1 << n); mask++) {
            int totalWeight = 0, totalValue = 0;
            for (int i = 0; i < n; i++) {
                if ((mask & (1 << i)) != 0) {
                    totalWeight += weights[i];
                    totalValue += values[i];
                }
            }
            if (totalWeight <= capacity && totalValue > best) {
                best = totalValue;
            }
        }
        return best;
    }

    public static void main(String[] args) {
        int[] weights = {3, 2, 1, 2};
        int[] values  = {4, 3, 1, 2};
        System.out.println(solve(weights, values, 4)); // 5
    }
}
```

This is $O(2^n)$. It works for small $n$.
At $n = 30$, it takes about a billion operations.
At $n = 50$, you are waiting longer than the age of the universe.

---

## Java: Dynamic Programming

The classic DP trick: build a table of "best value achievable with the first $i$ items and capacity $w$."

```java
public class KnapsackDP {

    public static int solve(int[] weights, int[] values, int capacity) {
        int n = weights.length;
        int[][] dp = new int[n + 1][capacity + 1];

        for (int i = 1; i <= n; i++) {
            for (int w = 0; w <= capacity; w++) {
                dp[i][w] = dp[i - 1][w];
                if (weights[i - 1] <= w) {
                    dp[i][w] = Math.max(dp[i][w],
                        dp[i - 1][w - weights[i - 1]] + values[i - 1]);
                }
            }
        }
        return dp[n][capacity];
    }

    public static void main(String[] args) {
        int[] weights = {3, 2, 1, 2};
        int[] values  = {4, 3, 1, 2};
        System.out.println(solve(weights, values, 4)); // 5
    }
}
```

This runs in $O(n \cdot W)$. Looks polynomial. But it is not.

The input size of $W$ is $\log_2 W$ bits.
So $O(n \cdot W)$ is actually $O(n \cdot 2^{\text{bits of } W})$, exponential in the input size.
This is called **pseudo-polynomial**: polynomial in the *numeric value* of the input, not in the *length* of the input.

If $W = 1{,}000$, the DP table has $1{,}000 \cdot n$ cells. Fast.
If $W = 2^{64}$, the DP table does not fit in any computer on Earth.

This is why the DP solution does not prove $P = NP$.

{% include quiz.html id="q4" %}

---

## The Practical Engineer's Response to Intractability

In Part 4, we saw engineers respond to **undecidability** with timeouts, probes, and heuristics.
The response to **intractability** is similar: give up on perfect, embrace good enough.

| Strategy              | Idea                                      | Example                                      |
|-----------------------|-------------------------------------------|----------------------------------------------|
| Approximation         | Get within a proven bound of optimal      | Greedy knapsack (sort by value/weight ratio) |
| Heuristics            | Use rules of thumb that usually work      | Bin packing in Kubernetes                    |
| Restrict the input    | Limit problem size so brute force is fine | Capacity planning with small $n$             |
| Randomized algorithms | Accept a small probability of being wrong | Randomized SAT solvers                       |
| Parallelism           | Throw more machines at it                 | MapReduce over subsets                       |

The pattern is the same as with undecidability: **know the theoretical limit, then choose a practical trade-off**.

---

## The Full Picture

We can now place everything on one map:

![The full picture: complexity classes nested within computability classes, from P at the center to undecidable problems at the edge](/assets/images/36/full-picture.svg)

Parts 1-4 zoomed from the innermost circle outward, through the Chomsky hierarchy.
Part 5 zoomed *into* the decidable region and found that it too has structure: an onion of complexity classes, each one exponentially harder than the last.

The takeaway for engineers?

**Know where your problem lives.** A problem in P gets a clean algorithm. A problem in NP-complete gets a heuristic. An undecidable problem gets a timeout and a prayer.

And the next time someone asks "why can't the computer just figure out the optimal schedule?" you will know: it probably *can*, but not before the heat death of the universe :D.

{% include quiz.html id="q5" %}

---

That wraps up the Computability Theory series!
From regex to the limits of computation, we have seen the full spectrum.

Stay curious, and ... until next time!