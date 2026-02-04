---
layout: post
title: "Computability Theory Part 1: The Chomsky Hierarchy and Regular Languages"
date: 2026-02-04
categories: ["theory-of-computation", "automata", "formal-languages", "java"]
---

*Every program you write is a language recognizer.*

Whether you are validating emails, parsing JSON, or compiling code; you are basically asking: "Does this string belong to my language?"

---

## The Chomsky Hierarchy

In 1956, Noam Chomsky classified formal languages into four types. 
This hierarchy tells you what machine you need to recognize each type.

| Type   | Language Class         | Recognizer               | Example         |
|--------|------------------------|--------------------------|-----------------|
| Type 3 | Regular                | Finite Automaton         | $a*b+$          |
| Type 2 | Context-Free           | Pushdown Automaton       | Balanced $()$   |
| Type 1 | Context-Sensitive      | Linear Bounded Automaton | $a^nb^nc^n$     |
| Type 0 | Recursively Enumerable | Turing Machine           | Halting problem |

Each level is strictly more powerful. 
Regex can't match balanced parentheses. 
Context-free grammars can't check three equal counts. 
And some problems can't be solved by *any* machine.

---

## Regular Languages (Type 3)

Regular languages need no memory, they just track your current state.

A **Finite Automaton** has:
- Finite states with transitions on input symbols
- One start state, one or more accepting states
- No stack, no tape

**Regular**: identifiers, numbers, log patterns, lexical tokens

**NOT Regular**: balanced parentheses $((()))$, palindromes, $a^nb^n$

The key insight here is that you can't "COUNT" unboundedly without memory.

**DFA** (Deterministic): exactly one transition per symbol i.e., one path through the machine.
**NFA** (Non-deterministic): multiple transitions allowed, epsilon moves. Explores all paths simultaneously.
**Key theorem**: They recognize the same languages. Any NFA converts to a DFA (possibly exponentially larger).

---

## Automata Are Everywhere

The idea of **state + transitions** is fundamental to computing:
- Network protocols (TCP states: LISTEN, ESTABLISHED, CLOSED...)
- UI components (button: idle → hover → pressed → idle)
- Game logic (player: idle → running → jumping → falling)
- Lexers (tokenizing source code character by character)

A simple example e.g., detecting if a string ends with `"ab"`:

```java
public class EndsWithAB {
    enum State { START, SAW_A, SAW_AB }

    public static boolean matches(String input) {
        State state = State.START;
        for (char c : input.toCharArray()) {
            state = switch (state) {
                case START, SAW_AB -> c == 'a' ? State.SAW_A : State.START;
                case SAW_A -> c == 'b' ? State.SAW_AB : (c == 'a' ? State.SAW_A : State.START);
            };
        }
        return state == State.SAW_AB;
    }
}
```

Three states, deterministic transitions, $O(n)$ time, $O(1)$ space.
This is exactly how regex engines work under the hood.

---

## Regex = Finite Automata

Regular expressions are algebraically equivalent to automata. 
Three core operations:

1. **Concatenation**: $ab$
2. **Alternation**: $a|b$
3. **Kleene Star**: $a*$

Everything else ($+$, $?$, ${n,m}$) is syntactic sugar.

### Backtracking vs Automata Engines

| Engine                    | Pros                | Cons                   |
|---------------------------|---------------------|------------------------|
| Backtracking (Java, PCRE) | Backrefs, lookahead | Exponential worst-case |
| Automata (RE2, Rust)      | $O(n)$ guaranteed   | No backreferences      |

**ReDoS warning**: Pattern $(a+)+b$ on input $aaa...c$ causes exponential backtracking. 
Use possessive quantifiers $(a++)+b$ to prevent.

---

## Why Regex Can't Match Parentheses

There is a theorem called the **Pumping Lemma** that lets you prove certain languages are not regular.
The intuition: if a language requires "counting" (like matching $n$ open parens with $n$ close parens), a finite automaton can not do it i.e., it has no memory to track the count.

That It's why you need a parser (context-free grammar) for nested structures like JSON, HTML, or arithmetic expressions.

---

## What's Next?

In the next blog post we would explore even more complex language structures within computability theory.
Moreover, we will parse arithmetic expressions and see why JSON needs more than regex.
Until then ... stay tuned! 
