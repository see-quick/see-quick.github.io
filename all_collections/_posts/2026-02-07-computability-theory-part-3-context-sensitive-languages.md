---
layout: post
title: "34 Computability Theory Part 3: Context-Sensitive Languages"
date: 2026-02-07
categories: ["theory-of-computation", "automata", "formal-languages", "java"]
---

*You know that coworker who reviews your PR and says "this variable name is fine here, but not there"? 
Congratulations, they are a context-sensitive grammar.*

In [Part 1](/posts/computability-theory-part-1-regular-languages), we matched patterns with no memory.
In [Part 2](/posts/computability-theory-part-2-context-free-languages), we added a stack and parsed nested structures.
Now we throw away the stack and upgrade to a full tape, but we are not allowed to use more space than the input gives us.
Welcome to the awkward middle child of the Chomsky hierarchy.

---

## The Problem with Stacks

Remember the language $a^nb^nc^n$?
Part 2 teased it as something context-free grammars can not handle.
Here is the basic intuition for *why*.

A pushdown automaton has one stack.
To check $a^nb^n$, you push all the $a$'s, then pop one for each $b$. Done.
But for $a^nb^nc^n$, after you've popped all the $a$'s to match the $b$'s... the stack is empty.
You have no idea how many $c$'s to expect.

It is like being a waiter who can carry a stack of plates.
You can match plates to tables one by one (LIFO), but if someone says "now also bring exactly that many forks," you are going to drop everything.

You need a **tape**. 
Something you can read, write, and move around on.
But not an infinite tape (i.e., that would be a Turing machine), and we are not ready for that kind of commitment.

---

## Context-Sensitive Grammars (Type 1)

A **Context-Sensitive Grammar (CSG)** has one crucial restriction on its production rules:

$$\alpha A \beta \to \alpha \gamma \beta$$

Where:
- $A$ is a non-terminal
- $\alpha$, $\beta$ are strings of terminals and non-terminals (the **context**)
- $\gamma$ is a non-empty string

In plain English, you can only replace $A$ with $\gamma$ **when $A$ appears between $\alpha$ and $\beta$**.
The non-terminal $A$ looks left, looks right, and says "okay, given who my neighbors are, I'll become $\gamma$."

Let's see a concrete example.
Suppose we have this rule:

$$a \; B \; c \to a \; b \; c$$

This says: "the non-terminal $B$ can become the terminal $b$, but **only** when it sits between an $a$ on the left and a $c$ on the right."
If $B$ appears next to different neighbors (say $x B y$), this rule does not apply.
The context ($a$ ... $c$) acts like a bouncer: "You're on the list, you may enter. You are not? Then wait."

An equivalent (and often simpler) way to state this is the **non-contracting** form:

> Every production $\alpha \to \beta$ must satisfy $\|\alpha\| \leq \|\beta\|$

No rule can make the string shorter (except the special case $S \to \varepsilon$ if $S$ never appears on the right side).
This means derivations can only grow or stay the same length.
Why does this matter?
It guarantees that any derivation **must terminate** (i.e., there are finitely many strings of a given length), which is a key difference from unrestricted (Type 0) grammars that can loop forever.

### Why "Context-Sensitive"?

In context-free grammars, a rule like $A \to \gamma$ applies **regardless** of what's around $A$.
The rule $A \to \gamma$ fires whether $A$ is surrounded by $x$'s, $y$'s, or sitting alone at a bar on a Friday night.

In context-sensitive grammars, the same non-terminal can expand differently depending on its **neighbors**.
It's the difference between:

- **Context-free**: "Every employee gets a $500 bonus" (same rule, always)
- **Context-sensitive**: "Employees in the engineering department get a $500 bonus, but employees in sales get a pizza party" (rule depends on context)

---

## A Grammar for $a^nb^nc^n$

Let's build a CSG that generates $a^nb^nc^n$. 
This is the canonical example, the "Hello, World!" of context-sensitive languages.

The idea is to generate $n$ copies of $abc$ in a controlled way, then sort them:

1. $S \to a B C$
2. $S \to a S B C$
3. $C B \to C Z$
4. $C Z \to W Z$
5. $W Z \to W C$
6. $W C \to B C$
7. $a B \to a b$
8. $b B \to b b$
9. $b C \to b c$
10. $c C \to c c$

Let me walk through generating $aabbcc$:

$$S \Rightarrow aSBC \Rightarrow aaBCBC$$

Now we need to "bubble sort" the $B$'s before the $C$'s (rules 3-6):

$$aaBCBC \Rightarrow aaBCZC \Rightarrow aaBWZC \Rightarrow aaBWCC \Rightarrow aaBBCC$$

Then convert $B$'s to $b$'s and $C$'s to $c$'s left to right (rules 7-10):

$$aaBBCC \Rightarrow aabBCC \Rightarrow aabbCC \Rightarrow aabbcC \Rightarrow aabbcc$$

It works, but look at those rules. 
We needed **ten** production rules and a bubble sort embedded in a grammar just to say "equal numbers of three letters."
Context-free grammars feel elegant.
Context-sensitive grammars feel like filling out tax forms :D ... hope you fill it this year (2026) :P.

---

## Linear Bounded Automata

Just as finite automata recognize regular languages and pushdown automata recognize context-free languages, **Linear Bounded Automata (LBAs)** recognize context-sensitive languages.

An LBA is a Turing machine with one restriction: **its tape is bounded by the length of the input**.

Think of it this way:

| Machine                  | Memory               | Analogy                              |
|--------------------------|----------------------|--------------------------------------|
| Finite Automaton         | None (just states)   | Goldfish: no memory, just vibes      |
| Pushdown Automaton       | Stack (LIFO)         | Stack of papers on your desk         |
| Linear Bounded Automaton | Tape (bounded)       | Whiteboard that fits in your office  |
| Turing Machine           | Tape (unbounded)     | Infinite whiteboard (dream scenario) |

An LBA can:
- Read and write on the tape
- Move the head left and right
- But it **cannot** extend the tape beyond the original input boundaries

It's like being given a fixed-size whiteboard. 
You can erase and rewrite as much as you want, but you can not tape on extra whiteboards. 
You must solve the problem *in-place*.

---

## Practical Example: Checking $a^nb^nc^n$

Let's build an LBA simulator in Java. 
The algorithm works directly on the input tape:

1. Scan left to right. Cross off one $a$, one $b$, and one $c$.
2. Rewind to the beginning.
3. Repeat until all characters are crossed off.
4. If you ever find a mismatch (e.g., $b$ before all $a$'s are gone), reject.

```java
public class LinearBoundedAutomaton {

    /**
     * Checks if input matches a^n b^n c^n using bounded tape only.
     * The char[] IS our tape. No extra data structures.
     */
    public static boolean accepts(String input) {
        char[] tape = input.toCharArray();
        int n = tape.length;

        // Must be divisible by 3
        if (n % 3 != 0) return false;
        if (n == 0) return true;

        while (true) {
            // Phase 1: Find and cross off one 'a'
            int i = 0;
            while (i < n && tape[i] == 'X') i++;  // skip crossed-off
            if (i == n) return true;               // all crossed off → accept!
            if (tape[i] != 'a') return false;      // expected 'a'
            tape[i] = 'X';                         // cross it off

            // Phase 2: Find and cross off one 'b'
            while (i < n && (tape[i] == 'X' || tape[i] == 'a')) i++;
            if (i == n || tape[i] != 'b') return false;
            tape[i] = 'X';

            // Phase 3: Find and cross off one 'c'
            while (i < n && (tape[i] == 'X' || tape[i] == 'b')) i++;
            if (i == n || tape[i] != 'c') return false;
            tape[i] = 'X';
        }
    }

    public static void main(String[] args) {
        System.out.println(accepts("abc"));       // true
        System.out.println(accepts("aabbcc"));    // true
        System.out.println(accepts("aaabbbccc")); // true
        System.out.println(accepts("aabbc"));     // false
        System.out.println(accepts("aabbcccc"));  // false
        System.out.println(accepts("abcabc"));    // false
        System.out.println(accepts(""));          // true (a^0 b^0 c^0)
    }
}
```

Notice what we did: **no stack, no extra arrays, no `HashMap`**.
We only used the input `char[]` itself as our working tape, writing `'X'` over consumed characters.
That is exactly what an LBA does. 
The tape *is* the input, and we never go past its boundaries.

The algorithm is $O(n^2)$ since we do $n/3$ passes over the tape. 
An LBA does not care about speed (i.e., it cares about **space**).

---

## Why Should You Care?

"Okay, cool, I can check $a^nb^nc^n$.
When will I ever need that?"

Fair question. 
You probably won't write $a^nb^nc^n$ checkers at work (if you do, we should talk :D).
But the **pattern** of context-sensitivity shows up more than you would expect:

### 1. Natural Language Agreement

English is (at least) context-sensitive. 
Consider:

> *"The dogs in the park **are** barking."*
> *"The dog in the park **is** barking."*

The verb form (`are` vs `is`) depends on the **subject** (`dogs` vs `dog`), but they can be separated by arbitrary prepositional phrases.
A context-free grammar can not enforce this long-distance agreement.

This is why natural language processing needed to move beyond CFGs. 
Your spell checker is not just parsing it is checking the **context**.

### 2. Cross-References in Documents

Ever written LaTeX and used `\label{fig:chart}` in one place and `\ref{fig:chart}` in another?
Checking that every `\ref` has a matching `\label` is again **context-sensitive**.
The reference and its definition can be arbitrarily far apart, with arbitrary content between them.

Same with programming: **"every variable must be declared before use"** is a context-sensitive constraint.
That is why compilers have a separate semantic analysis pass after parsing. 
The parser (CFG) builds the tree; the semantic analyzer (context-sensitive rules) checks the constraints.

### 3. The Copy Language

The language $\{ww : w \in \{a,b\}^*\}$ is the set of strings that consist of a word repeated exactly twice.
Some examples:

| String     | In the language? | Why?                                    |
|------------|------------------|-----------------------------------------|
| $abab$     | Yes              | $w = ab$, string is $ab \cdot ab$       |
| $aabbaabb$ | Yes              | $w = aabb$, string is $aabb \cdot aabb$ |
| $abba$     | No               | $ab \neq ba$                            |
| $aba$      | No               | Odd length, cannot split into $ww$      |

This seems simple. 
Can't you just split the string in half and compare?
Sure, **you** can. 
But a pushdown automaton cannot.

Here is the intuition: to verify $ww$, you would need to "remember" the entire first half and then check it against the second half symbol by symbol.
A stack can only give you the first half **in reverse** (LIFO). 
So a PDA could check $w w^R$ (a word followed by its reverse, i.e., a palindrome), but not $ww$ (a word followed by itself).

An LBA, on the other hand, can do it.
It has the entire input on its tape and can zig-zag back and forth, comparing the first character with the middle character, the second with middle+1, and so on.

Where does this show up in practice?

- **Echo protocols**: You send a message and the receiver echoes it back. Verifying the echo matches the original is exactly the $ww$ problem.
- **Data integrity**: The simplest "checksum" is just appending a copy of the data. Verifying it? Context-sensitive.
- **DNA biology**: Certain DNA structures involve tandem repeats (sequences duplicated next to each other). Recognizing them is this exact problem.

### 4. Configuration Validation

Consider a config file where one section must cross-reference another:

```yaml
databases:
  primary: postgres
  replica: postgres

connections:
  primary:            # must match a key in databases
    host: db1.local
  replica:            # must match a key in databases
    host: db2.local
```

Checking that every key in `connections` matches a key in `databases` is a context-sensitive problem.
JSON Schema, YAML validators, and **Kubernetes admission controllers** all deal with this kind of cross-referencing.

---

## The Chomsky Hierarchy: A Practical Perspective

Let's update our running comparison with a more... relatable framing:

| Type   | Class             | Machine     | Real Example                      | Vibe                                     |
|--------|-------------------|-------------|-----------------------------------|------------------------------------------|
| Type 3 | Regular           | DFA/NFA     | `grep`, lexers, input validation  | "I live in the moment"                   |
| Type 2 | Context-Free      | PDA         | Parsers, compilers, JSON          | "I can handle nesting, but just nesting" |
| Type 1 | Context-Sensitive | LBA         | Type checkers, NLP, cross-refs    | "Everything depends on everything"       |
| Type 0 | Rec. Enumerable   | Turing      | ...the halting problem            | "Hold my beer :D"                        |

The jump from Type 2 to Type 1 is where things get **expensive**.
Membership testing for context-sensitive languages is $PSPACE-complete$ (i.e., it's solvable, but potentially requires exponential time).
This is why compilers don't try to do everything in one grammar. 
They split the work:

1. **Lexer** (regular): break source into tokens
2. **Parser** (context-free): build a syntax tree
3. **Semantic analysis** (context-sensitive): type checking, scope resolution, declaration matching etc.

Each phase uses exactly the right level of power (i.e., not too little, not too much).

---

## Fun Facts About Context-Sensitive Languages

- **The LBA problem**: 
We *still* don't know whether deterministic LBAs are as powerful as nondeterministic LBAs (i.e., $\text{DSPACE}(n) \stackrel{?}{=} \text{NSPACE}(n)$). 
This is one of the oldest open problems in theoretical computer science, open since the 1960s.
- **Every context-sensitive language is decidable**: 
Unlike Type 0, where membership is only semi-decidable (might loop forever), CSLs always give you a yes/no answer. 
The trade-off? That answer might take a *very* long time.

---

## Context-Sensitive vs. Context-Free: A Side-by-Side

Let's make the distinction concrete with a Java example. Both snippets validate structure, but they need different levels of power:

```java
// Context-free: balanced parentheses
// A stack is sufficient
public static boolean balancedParens(String s) {
    int depth = 0;
    for (char c : s.toCharArray()) {
        if (c == '(') depth++;
        else if (c == ')') depth--;
        if (depth < 0) return false;
    }
    return depth == 0;
}

// Context-sensitive: matching three groups
// Need to scan the tape multiple times
public static boolean matchThreeGroups(String s) {
    // Validates a^n b^n c^n — see LBA example above
    char[] tape = s.toCharArray();
    int n = tape.length;
    if (n % 3 != 0) return false;
    if (n == 0) return true;

    while (true) {
        int i = 0;
        while (i < n && tape[i] == 'X') i++;
        if (i == n) return true;
        if (tape[i] != 'a') return false;
        tape[i] = 'X';

        while (i < n && (tape[i] == 'X' || tape[i] == 'a')) i++;
        if (i == n || tape[i] != 'b') return false;
        tape[i] = 'X';

        while (i < n && (tape[i] == 'X' || tape[i] == 'b')) i++;
        if (i == n || tape[i] != 'c') return false;
        tape[i] = 'X';
    }
}
```

The first one is linear time, single pass, one counter.
The second one makes multiple passes over the same tape, rewriting as it goes (i.e., fundamentally more complex).

---

## What's Next?

We have now climbed three levels of the Chomsky hierarchy:

```
  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 
  ░          Type 0: ???                      ░
  ░       (Turing Machine)                    ░
  ░                                           ░
  ░    "What CAN'T be computed?"              ░
  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
                    │
                    │      ¯\_(ツ)_/¯
                    │
  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
  ░      Type 1: Context-Sensitive            ░
  ░    (Linear Bounded Automaton)             ░  <-- YOU ARE HERE
  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
                    │
  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
  ░      Type 2: Context-Free                 ░  DONE
  ░    (Pushdown Automaton)                   ░
  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
                    │
  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
  ░      Type 3: Regular                      ░  DONE
  ░    (Finite Automaton)                     ░
  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
```

Next time, we reach the top: **Type 0 and Turing Machines**.
We will finally confront the question that haunts every programmer (i.e., *Are there problems that no computer, no matter how powerful, can ever solve?*)

...

Stay tuned ... and until next time!