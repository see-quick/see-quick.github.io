---
layout: post
title: "37 Computability Theory Part 6: Reductions, Proving Hardness and Solving Problems"
date: 2026-05-21
categories: ["theory-of-computation", "automata", "formal-languages", "java"]
quiz: computability-part-6
---

*Your colleague just proved that the scheduling problem is NP-complete.
Your manager asks: "So… can you still solve it?"
"Sure," you reply. "I'll reduce it to SAT and let a solver handle it."*

In [Part 1](/posts/computability-theory-part-1-regular-languages), we matched patterns.
In [Part 2](/posts/computability-theory-part-2-context-free-languages), we parsed nested structures.
In [Part 3](/posts/computability-theory-part-3-context-sensitive-languages), we checked cross-references.
In [Part 4](/posts/computability-theory-part-4-turing-machines-and-the-hardest-problems), we hit the wall: some problems are **impossible**.
In [Part 5](/posts/computability-theory-part-5-from-computability-to-complexity), we discovered that **possible** does not mean **practical**.
Now we learn the technique that ties everything together: **reductions**.

---

## What Is a Reduction?

A reduction transforms one problem into another.
If you can solve problem B, and you can transform every instance of problem A into an instance of B, then you can solve A too.

Think of it like a translator.
You do not speak French, but you have a French-to-English dictionary and an English teacher.
You **reduce** your French homework to English homework: translate the question, give it to the teacher, and the answer applies to the original problem.
The dictionary is your **reduction function**.

Formally, we write:

$$A \leq_p B$$

This means: there exists a function $f$, computable in polynomial time, such that for every input $x$:

$$x \in A \iff f(x) \in B$$

The function $f$ transforms instances of A into instances of B, preserving yes/no answers.
If B can be solved in polynomial time, then so can A (transform with $f$, then solve B).
**Contrapositive**: if A is hard, then B must be at least as hard.

### Karp vs. Cook Reductions

There are two flavors of reduction you will encounter:

- **Karp reductions** (many-one): transform the input once, call the solver once, return its answer directly. This is the $\leq_p$ notation above. Standard for NP-completeness proofs.
- **Cook reductions** (Turing): allow multiple calls to the solver, with arbitrary computation in between. More powerful, but Karp reductions are the standard tool for NP-completeness.

We will use Karp reductions throughout this post.

{% include quiz.html id="q1" %}

---

## Why Reductions Matter

Reductions are the Swiss Army knife of theoretical computer science.
They serve two purposes that look like opposites but are really two sides of the same coin.

### 1. Proving Hardness

In 1971, Stephen Cook proved that **SAT** (Boolean Satisfiability) is NP-complete.
In 1972, Richard Karp took that single result and **reduced** SAT to 21 other problems, proving all of them NP-complete in one sweep.

The chain keeps growing:

| From (known hard) | Reduced to | Year |
|--------------------|---------------------|------|
| SAT                | 3-SAT               | 1972 |
| 3-SAT              | Independent Set      | 1972 |
| 3-SAT              | Graph Coloring       | 1972 |
| Independent Set    | Vertex Cover         | 1972 |
| 3-SAT              | Hamiltonian Path     | 1972 |
| Hamiltonian Path   | Travelling Salesman  | 1972 |

Today, thousands of problems are known NP-complete.
Every single proof uses a chain of reductions that traces back to Cook's original SAT result.

### 2. Solving Problems in Practice

Here is the twist: the same technique works in **reverse** for practical problem-solving.

If you can reduce your hard problem **to** SAT, you can feed the resulting formula to a highly optimized SAT solver (MiniSat, CaDiCaL, Z3) and get an answer.
Modern SAT solvers handle formulas with **millions** of variables.
They do not solve the worst case faster (that would mean P = NP), but they exploit structure in real-world instances to find solutions remarkably fast.

This is how real tools work:
- **Hardware verification**: circuit properties are reduced to SAT
- **Planning and scheduling**: constraints become boolean formulas
- **Software verification**: bounded model checking reduces to SAT
- **Package managers**: dependency resolution is reduced to SAT (e.g., `apt-get`)

The insight is simple: **we do not need a separate algorithm for every NP-complete problem. We need one good solver and many good reductions.**

{% include quiz.html id="q2" %}

---

## How It Works: Graph Coloring → SAT

Let's build a real reduction.

**The problem**: given a graph and $k$ colors, can you color every vertex so that no two adjacent vertices share a color?
Graph $k$-coloring is NP-complete for $k \geq 3$.
But we do not need a specialized graph coloring algorithm.
We can **reduce** it to SAT and let a SAT solver do the work.

### The Encoding

For a graph with $n$ vertices and $k$ colors, we create boolean variables:

$$x_{v,c} = \text{"vertex } v \text{ gets color } c\text{"}$$

That gives us $n \times k$ variables. Now we need three types of clauses:

**1. At least one color per vertex.** Every vertex must be colored:

$$\text{For each vertex } v: \quad (x_{v,1} \lor x_{v,2} \lor \dots \lor x_{v,k})$$

**2. At most one color per vertex.** No vertex gets two colors:

$$\text{For each vertex } v \text{ and each pair } i \neq j: \quad (\neg x_{v,i} \lor \neg x_{v,j})$$

**3. Adjacent vertices differ.** For every edge $(u, v)$ and every color $c$:

$$(\neg x_{u,c} \lor \neg x_{v,c})$$

If the SAT solver finds a satisfying assignment, the graph is $k$-colorable.
If the formula is unsatisfiable, it is not.
The reduction is **polynomial**: we produce $O(n \cdot k^2 + m \cdot k)$ clauses, where $m$ is the number of edges.

### Java: The Full Pipeline

Here is a complete, runnable Java program.
The `reduce` method is the star: it transforms a graph coloring instance into a SAT formula.
The `solveSAT` method is a simple brute-force solver so you can run the full pipeline.

{% raw %}
```java
import java.util.*;

public class GraphColoringToSAT {

    // --- The Reduction (the interesting part) ---

    static int var(int vertex, int color, int k) {
        return vertex * k + color + 1; // SAT variables are 1-indexed
    }

    static List<int[]> reduce(int[][] edges, int numVertices, int k) {
        List<int[]> clauses = new ArrayList<>();

        for (int v = 0; v < numVertices; v++) {
            // At least one color per vertex
            int[] atLeastOne = new int[k];
            for (int c = 0; c < k; c++) {
                atLeastOne[c] = var(v, c, k);
            }
            clauses.add(atLeastOne);

            // At most one color per vertex
            for (int i = 0; i < k; i++) {
                for (int j = i + 1; j < k; j++) {
                    clauses.add(new int[]{-var(v, i, k), -var(v, j, k)});
                }
            }
        }

        // Adjacent vertices must differ
        for (int[] edge : edges) {
            int u = edge[0], v = edge[1];
            for (int c = 0; c < k; c++) {
                clauses.add(new int[]{-var(u, c, k), -var(v, c, k)});
            }
        }

        return clauses;
    }

    // --- Simple brute-force SAT solver (for demonstration) ---

    static boolean solveSAT(List<int[]> clauses, int numVars) {
        for (int mask = 0; mask < (1 << numVars); mask++) {
            boolean satisfies = true;
            for (int[] clause : clauses) {
                boolean clauseSat = false;
                for (int lit : clause) {
                    int v = Math.abs(lit) - 1;
                    boolean val = (mask & (1 << v)) != 0;
                    if (lit > 0 ? val : !val) {
                        clauseSat = true;
                        break;
                    }
                }
                if (!clauseSat) {
                    satisfies = false;
                    break;
                }
            }
            if (satisfies) return true;
        }
        return false;
    }

    public static void main(String[] args) {
        //   0 --- 1
        //   |   / |
        //   |  /  |
        //   3 --- 2
        int[][] edges = {{0,1}, {1,2}, {2,3}, {3,0}, {1,3}};
        int numVertices = 4;

        // 3 colors: satisfiable
        List<int[]> formula3 = reduce(edges, numVertices, 3);
        int numVars3 = numVertices * 3;
        System.out.println("3-colorable? " + solveSAT(formula3, numVars3)); // true

        // 2 colors: unsatisfiable (graph contains a triangle: 0-1-3)
        List<int[]> formula2 = reduce(edges, numVertices, 2);
        int numVars2 = numVertices * 2;
        System.out.println("2-colorable? " + solveSAT(formula2, numVars2)); // false
    }
}
```
{% endraw %}

The `reduce` method is the entire reduction: 30 lines that transform a graph coloring question into a SAT formula.
The `solveSAT` method is a $O(2^n)$ brute-force solver that tries every possible truth assignment.

In practice, you would replace `solveSAT` with a real solver like [MiniSat](http://minisat.se/), [CaDiCaL](https://github.com/arminbiere/cadical), or [Z3](https://github.com/Z3Prover/z3).
The reduction stays exactly the same.
Only the solver changes, and modern solvers handle formulas with millions of variables by exploiting structure in real-world instances (conflict-driven clause learning, unit propagation, and other techniques that crush practical SAT instances even though worst-case is still exponential).

{% include quiz.html id="q3" %}

---

## You Already Have These Problems

Graph coloring sounds academic, but you are probably solving it already — you just call it something else.

### Rack-Aware Replica Assignment

In Apache Kafka, each partition has multiple replicas.
A key constraint: **no two replicas of the same partition should land on the same rack** (or availability zone), because a rack failure would take out all copies at once.

This is graph coloring:
- **Vertices** = replicas
- **Edges** = "these two replicas belong to the same partition" (they must not share a rack)
- **Colors** = racks / availability zones

If you have 3 racks, you are solving 3-coloring.
Kafka's built-in replica assignment uses heuristics (round-robin with rack awareness), but the underlying problem is exactly the graph coloring we just reduced to SAT.
For complex topologies with additional constraints (disk balancing, network locality), a SAT-based approach can find valid assignments that heuristics miss.

### Consumer Group Rebalancing

Kafka consumer groups must assign partitions to consumers.
Add constraints: co-locate partitions that share state, spread load evenly, respect consumer capacity limits.

This is again a coloring-style constraint satisfaction problem:
- **Vertices** = partitions
- **Edges** = "these partitions conflict" (co-locality requirements, same-consumer limits)
- **Colors** = consumers

Kafka's `CooperativeStickyAssignor` uses heuristics to approximate a good solution.
A SAT-based assignor could find provably optimal assignments, or prove that no valid assignment exists under the given constraints (i.e., something heuristics can never guarantee).

### The Pattern

Whenever you see "assign X to Y such that conflicting X's don't share a Y," you are looking at graph coloring.
And graph coloring reduces to SAT.
So you already know how to solve it.

---

The next time you face a problem that feels impossibly hard, ask yourself: can I reduce it to something a solver already handles?
Chances are, someone has already built the solver. You just need the reduction.

---

Stay curious, and ... until next time!