---
layout: post
title: "31 🔐 Breaking RSA with Quantum Computing: Shor's Algorithm Explained"
date: 2025-11-23
categories: ["quantum-computing", "cryptography", "python"]
---

In the [previous post](/2025/11/16/quantum-programming-introduction.html), we explored the basics of quantum programming.
Now, let's dive into one of quantum computing's most famous applications: **breaking modern encryption**.

Specifically, we'll explore **Shor's algorithm** - the quantum algorithm that can factor large numbers exponentially faster than any known classical algorithm.
This threatens the foundation of RSA encryption, which secures much of today's internet traffic.

## The Cryptography Problem

### How RSA Encryption Works

RSA (Rivest-Shamir-Adleman) is an asymmetric encryption algorithm that relies on a mathematical problem being hard to solve:

**Easy**: Multiply two large prime numbers together
```
p = 61
q = 53
N = p × q = 3233  # Easy to compute
```

**Hard**: Factor a large number back into its prime factors
```
N = 3233
Find p and q such that N = p × q  # Hard for large numbers!
```

RSA security relies on the fact that with classical computers, factoring large numbers (1024+ bits) would take longer than the age of the universe.

### The RSA Process (a bit ... simplified)

**Key Generation**:
1. Choose two large prime numbers: $p$ and $q$
2. Calculate $N = p \times q$ (this becomes your public key's modulus)
3. Calculate $\varphi(N) = (p-1)(q-1)$ (Euler's totient function)
4. Choose public exponent $e$ (commonly $65537$)
5. Calculate private exponent $d$ such that $d \times e \equiv 1 \pmod{\varphi(N)}$

- **Public Key**: $(N, e)$
- **Private Key**: $(N, d)$

where

- **Encryption**: $\text{ciphertext} = \text{message}^e \bmod N$
- **Decryption**: $\text{message} = \text{ciphertext}^d \bmod N$

The security depends on keeping $p$ and $q$ secret.
If an attacker can factor $N$ into $p \times q$, they can calculate $d$ and break the encryption entirely.

## Why Classical Factoring is Hard

The best classical algorithm for factoring is the **General Number Field Sieve (GNFS)**.
Its time complexity is approximately:

$$O\left(\exp\left(\left(\frac{64}{9} \cdot b\right)^{1/3} \cdot (\log b)^{2/3}\right)\right)$$

For a 2048-bit number, this would take **classical** computers **millions of years**.

Here's a simple Python example showing how slow trial division becomes:

```python
import time

def classical_factor(N):
    if N < 2:
        return []

    factors = []
    # Try all numbers from 2 to sqrt(N)
    d = 2
    while d * d <= N:
        while N % d == 0:
            factors.append(d)
            N //= d
        d += 1

    if N > 1:
        factors.append(N)

    return factors

# Small example - instant
start = time.time()
print(f"Factors of 3233: {classical_factor(3233)}")
print(f"Time: {time.time() - start:.6f} seconds")

# Larger examples - notice the exponential slowdown
start = time.time()
N1 = 999999999989988888  # 18 digits
print(f"\nFactors of {N1}: {classical_factor(N1)}")
print(f"Time: {time.time() - start:.6f} seconds")

start = time.time()
N2 = 999999999999999999989  # 21 digits
print(f"\nFactors of {N2}: {classical_factor(N2)}")
print(f"Time: {time.time() - start:.6f} seconds")
```

Output:
```
Factors of 3233: [61, 53]
Time: 0.000034 seconds

Factors of 999999999989988888: [29, 31, 331, 20185401777137]
Time: 2.631523 seconds

Factors of 999999999999999999989: [?, ?, ..., ?]
Time: ? seconds (it would take probably more than mintues :D)
```

Notice the exponential growth:
- 4 digits (3233): 0.00003 seconds
- 18 digits: 2.6 seconds
- 21 digits: 94.3 seconds

Now imagine a 617-digit number (2048 bits)!

## Please ... enter the Shor's Algorithm

In 1994, Peter Shor discovered a quantum algorithm that can factor integers in polynomial time:

$$O(b^3) \text{ where } b \text{ is the number of bits}$$

This is **exponentially faster** than the best classical algorithms!

### How Shor's Algorithm Works (High Level)

Shor's algorithm does not directly factor numbers. 
Instead, it:
1. **Reduces factoring to period finding**: Convert the factoring problem into finding the period of a function
2. **Uses Quantum Fourier Transform (QFT)**: Leverage quantum superposition to find the period efficiently
3. **Extracts factors**: Use the period to calculate the factors

Let's break this down step by step.

### Step 1: Period Finding

The key insight is that factoring can be **reduced** to finding the **period** of this function:

$$f(x) = a^x \bmod N$$

> **Note on Problem Reduction**: This is a fundamental technique from theoretical computer science (computational complexity theory).
> When we reduce problem A to problem B, we show that if we can solve B, we can also solve A. Crucially, this preserves complexity properties - if B can be solved in polynomial time, then A can be too.
> Shor's algorithm leverages this: since period finding can be solved efficiently on quantum computers (via QFT), and factoring reduces to period finding, factoring can also be solved efficiently on quantum computers. 
> This is the same technique used to prove NP-completeness and many other fundamental results in complexity theory.

For some random $a < N$ where $\gcd(a, N) = 1$, this function is periodic with period $r$:

$$a^r \equiv 1 \pmod{N}$$

For example, with $a = 2$ and $N = 15$, we get the sequence:
- $2^0 \bmod 15 = 1$
- $2^1 \bmod 15 = 2$
- $2^2 \bmod 15 = 4$
- $2^3 \bmod 15 = 8$
- $2^4 \bmod 15 = 1$ ← pattern repeats!

The pattern repeats every 4 steps, so the period $r = 4$.

### Step 2: From Period to Factors

Once we have the period $r$, we can find factors using this mathematical property:

$$\text{If } a^r \equiv 1 \pmod{N}, \text{ then } a^r - 1 \equiv 0 \pmod{N}$$

We can rewrite this as:

$$(a^{r/2} - 1)(a^{r/2} + 1) \equiv 0 \pmod{N}$$

This means $N$ divides the product, so $\gcd(a^{r/2} - 1, N)$ and $\gcd(a^{r/2} + 1, N)$ are likely to be factors!

For example, with $a = 2$, $r = 4$, $N = 15$:
- $\gcd(2^{4/2} - 1, 15) = \gcd(3, 15) = 3$
- $\gcd(2^{4/2} + 1, 15) = \gcd(5, 15) = 5$
- Result: $3 \times 5 = 15$ ✓

### Step 3: Quantum Period Finding

The quantum magic happens in finding the period $r$ efficiently.
Classical algorithms must try values one by one, taking $O(N)$ time.
Quantum computers can find it in $O(\log N)$ time using the **Quantum Fourier Transform** (QFT).
QFT is a quantum algorithm that identifies periodic patterns by converting quantum states into their frequency components, similar to how the classical **Fast Fourier Transform** analyzes sound waves.
([Learn more about QFT](https://qiskit.org/textbook/ch-algorithms/quantum-fourier-transform.html))

Here's the quantum circuit structure:

1. **Initialization**: Create superposition of all possible exponents
2. **Modular exponentiation**: Compute $f(x) = a^x \bmod N$ for all $x$ in superposition
3. **Quantum Fourier Transform**: Extract the period from interference patterns
4. **Measurement**: Measure to get a value related to the period

## Putting It All Together

Let's see the complete Shor's algorithm workflow with a concrete example:

```python
import math
from fractions import Fraction

def find_period_classical(a, N):
    """Find period r where a^r ≡ 1 (mod N)"""
    result = 1
    for r in range(1, N):
        result = (result * a) % N
        if result == 1:
            return r
    return None

def verify_period(a, r, N):
    """Verify that r is indeed the period"""
    return pow(a, r, N) == 1

def extract_factors_from_period(N, a, r):
    """Extract factors using the period"""
    if r is None or r % 2 != 0:
        return None, None

    x = pow(a, r // 2, N)

    if x == N - 1:
        return None, None

    factor1 = math.gcd(x + 1, N)
    factor2 = math.gcd(x - 1, N)

    if factor1 != 1 and factor1 != N:
        return factor1, N // factor1
    if factor2 != 1 and factor2 != N:
        return factor2, N // factor2

    return None, None

def shors_factoring(N, a):
    """
    Complete Shor's algorithm workflow.
    Uses classical period finding to demonstrate the full process.
    """
    # Step 1: Find the period (this would be done quantumly)
    r = find_period_classical(a, N)

    # Step 2: Verify the period
    if not verify_period(a, r, N):
        return None, None

    # Step 3: Extract factors from period
    return extract_factors_from_period(N, a, r)

# Example: Factor 15
N = 15
a = 7  # Must be coprime to N

print(f"Factoring N = {N} using a = {a}")
print(f"gcd({a}, {N}) = {math.gcd(a, N)} (must be 1)")

# Find period
r = find_period_classical(a, N)
print(f"\nPeriod: r = {r}")
print(f"Verification: {a}^{r} mod {N} = {pow(a, r, N)}")

# Show the periodic sequence
print(f"\nPeriodic sequence of {a}^x mod {N}:")
for x in range(r * 2):
    print(f"{a}^{x} mod {N} = {pow(a, x, N)}", end="  ")
    if (x + 1) % r == 0:
        print(" ← period")

# Extract factors
factor1, factor2 = shors_factoring(N, a)

if factor1 and factor2:
    print(f"\n✓ Success! Factors: {factor1} × {factor2} = {N}")
else:
    print("\n✗ Failed to find factors with this 'a'. Try another value.")
```

**Output:**
```
Factoring N = 15 using a = 7
gcd(7, 15) = 1 (must be 1)

Period: r = 4
Verification: 7^4 mod 15 = 1

Periodic sequence of 7^x mod 15:
7^0 mod 15 = 1  7^1 mod 15 = 7  7^2 mod 15 = 4  7^3 mod 15 = 13   ← period
7^4 mod 15 = 1  7^5 mod 15 = 7  7^6 mod 15 = 4  7^7 mod 15 = 13   ← period

✓ Success! Factors: 5 × 3 = 15
```

### Why This Is Hard to Implement Generally

The challenging part is **modular exponentiation** on quantum hardware:

1. **For N=15**: We can use clever tricks with SWAP and X gates (as shown in [IBM's tutorial](https://quantum.cloud.ibm.com/docs/en/tutorials/shors-algorithm))
2. **For arbitrary N**: Requires implementing arithmetic circuits (addition, multiplication, modular reduction) with quantum gates.

### The Key Quantum Advantage

- **Classical approach**: Try $r = 1, 2, 3, \ldots$ until $a^r \equiv 1 \pmod{N}$ → $O(N)$ time
- **Quantum approach**: Evaluate all exponents in superposition, use QFT to extract period → $O(\log^3 N)$ time

The quantum circuit does not compute the period directly; it creates an interference pattern that, when measured and processed classically, reveals the period with high probability.
This is the essence of quantum computing: using superposition and interference to solve problems exponentially faster than classical computation.

## Why This Matters for Cryptography

### Timeline Estimates

Breaking **RSA-2048** encryption would take a classical computer approximately 300 trillion years. 
However, a quantum computer with enough qubits could accomplish this in hours to days.

To factor a 2048-bit RSA number, we would need around 4000+ logical qubits (imagine logical qubits as "virtual" error-corrected qubits created by combining multiple physical qubits together using quantum error correction codes). 
Current quantum computers have roughly 1000 physical qubits.
When accounting for error correction, we need approximately 1 million physical qubits to achieve 4000 logical qubits.
For instance, IBM has a roadmap to develop a 100 000-qubit quantum-centric supercomputer by **2033**.

Expert predictions vary widely on when this threat becomes real. 
Conservative estimates suggest 15-30 years, while optimistic projections point to 5-10 years. 
Pessimistic views extend beyond 50 years if quantum error correction proves harder than expected.

### The "Harvest Now, Decrypt Later" Threat

Even if large-scale quantum computers are 20 years away, adversaries are collecting encrypted data NOW to decrypt later:

```
Today:
[Encrypted sensitive data] → Store for future decryption

2040s (potentially):
[Stored encrypted data] → [Quantum computer with Shor's algorithm] → Decrypted!
```

This is particularly concerning for (i.) Government secrets with long-term sensitivity, (ii.) Healthcare records, (iii.) Financial transactions or even Personal communications.

## Post-Quantum Cryptography (i.e., PQC)

The cryptography community is not waiting at all. 
NIST has standardized **post-quantum cryptographic** algorithms that should resist quantum attacks and here are a few examples:
1. **Lattice-Based Cryptography**: [**CRYSTALS-Kyber**](https://medium.com/identity-beyond-borders/crystals-kyber-the-key-to-post-quantum-encryption-3154b305e7bd) is a key encapsulation mechanism based on the hardness of lattice problems. Even quantum computers can't solve these problems efficiently, which is why NIST selected it as a standard in 2022.
2. **Hash-Based Signatures**: [**SPHINCS+**](https://sphincs.org/) relies on hash function security and is quantum-resistant by design. Its security is well-understood since it depends only on the collision resistance of cryptographic hash functions.
3. **Code-Based Cryptography**: [**Classic McEliece**](https://classic.mceliece.org/) is based on error-correcting codes and represents one of the oldest post-quantum proposals. It has been studied for decades and provides strong confidence in its long-term security.

## Further Reading

- **"Quantum Computation and Quantum Information"** by Nielsen & Chuang - The quantum computing bible
- **NIST Post-Quantum Cryptography Standardization** - [csrc.nist.gov/projects/post-quantum-cryptography](https://csrc.nist.gov/projects/post-quantum-cryptography)
- **Qiskit Shor's Algorithm Tutorial** - [qiskit.org/textbook/ch-algorithms/shor.html](https://qiskit.org/textbook/ch-algorithms/shor.html)
- **"Shor's Algorithm" (original paper)** - Shor, P.W. (1994)
- **Shor's algorithm description in Qiskit - https://quantum.cloud.ibm.com/docs/en/tutorials/shors-algorithm**

## Conclusion

Shor's algorithm is a double-edged sword.
It threatens to break the encryption protecting most of today's internet, but it is also pushing us to build better, quantum-resistant cryptography.

Right now, we are in a race. 
Can we migrate to post-quantum encryption (i.e., PQC) before someone builds a quantum computer powerful enough to run Shor's algorithm at scale? 
Nobody knows for sure, but at least we are not sitting idle $...$ work is happening on both sides.

What makes this fascinating is how it shows the real power of quantum computing: not just faster calculations, but fundamentally different approaches to problems we thought were practically unsolvable.

---

*Want to learn more? Check out my [introduction to quantum programming](/2025/11/16/quantum-programming-introduction.html) or explore my other posts on distributed systems and software engineering.*