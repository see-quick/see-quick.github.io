---
layout: post
title: "33 Computability Theory Part 2: Context-Free Languages"
date: 2026-02-06
categories: ["theory-of-computation", "automata", "formal-languages", "java"]
---

*Every time you parse JSON, evaluate `3 + 4 * 5`, or compile code, you are using a context-free grammar.*

In [Part 1](/posts/computability-theory-part-1-regular-languages), we explored regular languages and finite automata. 
We saw that regex can't match balanced parentheses because finite automata have no memory. 
Now we add a stack (i.e., memory) into computation.

---

## Context-Free Grammars (Type 2)

A **Context-Free Grammar (CFG)** consists of:
- **Terminals**: actual symbols (tokens) like $+$, $($, $42$
- **Non-terminals**: abstract symbols like $Expr$, $Term$
- **Production rules**: how to expand non-terminals
- **Start symbol**: where parsing begins

Here's a grammar for balanced parentheses:

* $S → ( S )$
* $S → S S$
* $S → ε$

This says: a valid string is either empty, two valid strings concatenated, or a valid string wrapped in parentheses.

Try deriving $(())$:

$S → ( S ) → ( ( S ) ) → ( ( ) )$

No finite automaton can do this. 
The grammar "remembers" how many opens need closing.

---

## Why CFGs Are More Powerful

Regular languages use **finite memory** (states).
Context-free languages use **unbounded stack memory**.

| Language      | Regular? | Context-Free? |
|---------------|----------|---------------|
| $a*b*$        | Yes      | Yes           |
| $a^nb^n$      | No       | Yes           |
| Balanced $()$ | No       | Yes           |
| Valid JSON    | No       | Yes           |
| $a^nb^nc^n$   | No       | No            |

The key point is that CFLs can count and match, but only in a **nested** (LIFO) pattern.

---

## Pushdown Automata

A **Pushdown Automaton (PDA)** is a finite automaton with a stack. 
It can (i.) push symbols onto the stack; (ii.) pop symbols from the stack; (iii.) make transitions based on input AND stack top

For the balanced parentheses example:

- **State**: $q_0$ (start and accept)
  - If $($:  push $($ onto stack, stay in $q_0$
  - If $)$:  pop $($ from stack, stay in $q_0$
  - If $EOF$:  accept if stack is empty

The stack tracks nesting depth. 
Each $($ pushes, each $)$ pops.
If we finish with an empty stack, the parentheses are balanced.

> Key theorem here is that PDAs and CFGs recognize exactly the same languages.

---

## Practical Example: Arithmetic Parser

Let's build a simple recursive descent parser for expressions like `3 + 4 * 5`.

First, the grammar (with correct precedence):

* $Expr \to Term \; ((+ \mid -) \; Term)^*$
* $Term \to Factor \; ((* \mid /) \; Factor)^*$
* $Factor \to \text{NUMBER} \mid ( \; Expr \; )$

This grammar encodes precedence: `*` binds tighter than `+` because `Factor` is "deeper" in the grammar.

```java
public class ArithmeticParser {
    private final String input;
    private int pos = 0;

    public ArithmeticParser(String input) {
        this.input = input.replaceAll("\\s+", "");
    }

    public double parse() {
        double result = parseExpr();
        if (pos != input.length()) {
            throw new RuntimeException("Unexpected: " + input.charAt(pos));
        }
        return result;
    }

    // Expr → Term (('+' | '-') Term)*
    private double parseExpr() {
        double result = parseTerm();
        while (pos < input.length()) {
            char op = input.charAt(pos);
            if (op == '+') {
                pos++;
                result += parseTerm();
            } else if (op == '-') {
                pos++;
                result -= parseTerm();
            } else {
                break;
            }
        }
        return result;
    }

    // Term → Factor (('*' | '/') Factor)*
    private double parseTerm() {
        double result = parseFactor();
        while (pos < input.length()) {
            char op = input.charAt(pos);
            if (op == '*') {
                pos++;
                result *= parseFactor();
            } else if (op == '/') {
                pos++;
                result /= parseFactor();
            } else {
                break;
            }
        }
        return result;
    }

    // Factor → NUMBER | '(' Expr ')'
    private double parseFactor() {
        if (pos < input.length() && input.charAt(pos) == '(') {
            pos++; // consume '('
            double result = parseExpr();
            if (pos >= input.length() || input.charAt(pos) != ')') {
                throw new RuntimeException("Expected ')'");
            }
            pos++; // consume ')'
            return result;
        }
        return parseNumber();
    }

    private double parseNumber() {
        int start = pos;
        while (pos < input.length() &&
               (Character.isDigit(input.charAt(pos)) || input.charAt(pos) == '.')) {
            pos++;
        }
        if (start == pos) {
            throw new RuntimeException("Expected number at position " + pos);
        }
        return Double.parseDouble(input.substring(start, pos));
    }

    public static void main(String[] args) {
        ArithmeticParser parser = new ArithmeticParser("3 + 4 * 5");
        System.out.println(parser.parse()); // 23.0

        parser = new ArithmeticParser("(3 + 4) * 5");
        System.out.println(parser.parse()); // 35.0
    }
}
```

Each method corresponds to a grammar rule. 
The call stack acts as our PDA's stack, tracking nested expressions.

---

## Parse Trees and Ambiguity

A **parse tree** shows how a string derives from the grammar:

```
        Expr
       / | \
    Term '+' Term
     |       / | \
  Factor  Factor '*' Factor
     |       |        |
     3       4        5
```

This tree shows $3 + (4 * 5)$ i.e., multiplication happens first.

### Ambiguous Grammars

A grammar is **ambiguous** if a string has multiple parse trees. 
Consider:
- $E → E + E$
- $E → E * E$
- $E → \text{NUMBER}$

The string $3 + 4 * 5$ can parse as:
- $(3 + 4) * 5 = 35$
- $3 + (4 * 5) = 23$

This is why we structure the grammar with precedence levels.

### The Dangling Else

Classic ambiguity in programming languages:
- $if (a)$ 
  - $if (b)$ 
    - $x();$ 
  - $else$
    - $y();$

or 

- $if (a)$
  - $if (b)$
    - $x();$
- $else$
  - $y();$

Does $else$ bind to the inner or outer $if$? 
Most languages choose inner (nearest), but the naive grammar is ambiguous. 
Solutions: (i.) rewrite the grammar to force binding; (ii.) use explicit $endif$ or braces; (iii.) parser disambiguation rules

---

## What CFGs Cannot Do

Just as regular languages have limits, so do context-free languages.

The **Pumping Lemma for CFLs** proves that $a^nb^nc^n$ is not context-free. 
Intuitively: a stack can match two things (push $a$'s, pop for $b$'s), but not three simultaneously.

| Language                       | Context-Free? | Why Not?                      |
|--------------------------------|---------------|-------------------------------|
| $a^nb^nc^n$                    | No            | Can't track three counts      |
| $\\{ww : w \in \\{a,b\\}^*\\}$ | No            | Can't compare two halves      |
| Type checking                  | No            | Requires symbol table context |

For these, we need more powerful formalisms.

---

## Real-World Applications

Context-free grammars power:

- **Programming language parsers**: Java, Python, C all use CFGs
- **Data formats**: JSON, XML, HTML (well, they try...)
- **Domain-specific languages**: SQL, GraphQL, regular expressions themselves
- **Natural language processing**: Sentence structure (though NL is messier)

Tools like **ANTLR**, **Bison**, and **JavaCC** generate parsers directly from grammar specifications.

---

## What's Next?

We have climbed two levels of the Chomsky hierarchy:

```
                                                   .  .  .
                                                   .  .  .
                                                      │
                                      ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
                                      ░            Type 1: ???              ░
                                      ░               ( ? )                 ░
                                 ┌────░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
                                 │
                                 │       o
                                 │      /|\
                                 │      / \
                    ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
                    ░    Type 2: Context-Free             ░
                    ░    (Pushdown Automaton)             ░  <-- YOU ARE HERE
               ┌────░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
               │
  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
  ░      Type 3: Regular              ░  DONE
  ░    (Finite Automaton)             ░
  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
```

Next, we climb higher into the unknown.
What lies beyond context-free grammars?
What problems can no algorithm ever solve?

Well ... stay tuned ...  and until next time!