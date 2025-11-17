---
layout: post
title: "30 🔮 Quantum Programming on Your Laptop: Introduction"
date: 2025-11-17
categories: ["quantum-computing", "python"]
---

Ever wondered what quantum computing is all about, but thought you'd need access to a million-dollar quantum computer to try it? 
Good news: you can start experimenting with quantum programming right now on your laptop! 
In this post, we'll explore the basics of quantum computing and write our first quantum programs using Python and Qiskit.

## What is Quantum Computing (in Simple Terms)?

Classical computers work with **bits** that are either 0 or 1. 
Quantum computers work with **qubits** (quantum bits) that can be in a **superposition** i.e., essentially being 0 and 1 at the same time until you measure them.

Think of it like a coin:
- A classical bit is like a coin sitting on a table showing heads or tails
- A qubit is like a coin spinning in the air (i.e., it's both heads and tails simultaneously until it lands)

Two key quantum phenomena make quantum computers powerful:

1. **Superposition**: A qubit can be in multiple states simultaneously
2. **Entanglement**: Qubits can be correlated in ways that classical bits cannot

## Why Simulate on a Classical PC?

"Wait," you might ask, "if quantum computers are so special, how can we simulate them on regular computers?"

The answer is: we can, but with limitations. 
Classical computers can simulate small quantum circuits (up to about 20-30 qubits reliably), which is perfect for learning and experimenting. 
For production quantum algorithms, you would eventually use real quantum hardware, but simulation is ideal for:

- Learning quantum programming concepts
- Developing and debugging quantum algorithms
- Running small experiments without queue times on real quantum hardware
- Understanding quantum behavior before investing in expensive quantum cloud time

## Setting Up Your Quantum Programming Environment

Let's get started! We'll use **Qiskit**, IBM's open-source quantum computing framework.
There are also other alternatives such as [CirQ](https://quantumai.google/cirq) from Google or [Q#](https://learn.microsoft.com/en-us/azure/quantum/qsharp-overview) from Microsoft.

### Prerequisites

- Python 3.8 or higher
- pip (Python package manager) or uv

### Installation

```bash
# Create a virtual environment (optional but recommended)
python -m venv quantum-env
source quantum-env/bin/activate  # On Windows: quantum-env\Scripts\activate

# Install Qiskit
pip install qiskit qiskit-aer

# For visualization (optional but helpful)
pip install matplotlib pylatexenc
```

And that's basically it for the setup your environment. 
Now we are ready to write some simple quantum programs.

## Your First Quantum Program: Quantum Coin Flip

Let's create a truly random coin flip using quantum superposition. 
This is quantum computing's "Hello, World!"

```python
from qiskit import QuantumCircuit, transpile
from qiskit_aer import AerSimulator

# Create a quantum circuit with 1 qubit and 1 classical bit
qc = QuantumCircuit(1, 1)

# Apply a Hadamard gate to create superposition
# This puts the qubit into an equal superposition of |0⟩ and |1⟩
qc.h(0)

# Measure the qubit and store result in classical bit
qc.measure(0, 0)

# Visualize the circuit
print(qc.draw())

# Simulate the circuit
simulator = AerSimulator()
compiled_circuit = transpile(qc, simulator)
result = simulator.run(compiled_circuit, shots=1).result()

# Get the measurement result
counts = result.get_counts()
print(f"Result: {counts}")
```

When you run this, you'll get either `{'0': 1}` or `{'1': 1}` -> a truly random result based on quantum mechanics!

### What's Happening Here?

1. **QuantumCircuit(1, 1)**: Creates a circuit with 1 qubit and 1 classical bit for storing results
2. **qc.h(0)**: Applies a Hadamard gate to qubit 0, creating superposition (50/50 chance of 0 or 1)
3. **qc.measure(0, 0)**: Measures qubit 0 and stores the result in classical bit 0
4. **AerSimulator()**: IBM's quantum simulator that runs on your classical computer
5. **shots=1**: Run the circuit once (we could run it 1000 times to see the probability distribution)

## Understanding Quantum Gates

Quantum gates are the building blocks of quantum circuits, similar to how AND, OR, NOT are gates in classical circuits. 
Here are the most common ones:

### Basic Single-Qubit Gates

**X Gate (Quantum NOT)**: Flips the qubit state
```python
qc = QuantumCircuit(1)
qc.x(0)  # If qubit was |0⟩, it's now |1⟩
```

**Hadamard Gate (H)**: Creates superposition
```python
qc = QuantumCircuit(1)
qc.h(0)  # Puts qubit into equal superposition of |0⟩ and |1⟩
```

**Z Gate**: Adds a phase flip
```python
qc = QuantumCircuit(1)
qc.z(0)  # Flips the phase of |1⟩ state
```

### Two-Qubit Gates

**CNOT (Controlled-NOT)**: Flips second qubit if first qubit is |1⟩
```python
qc = QuantumCircuit(2)
qc.cx(0, 1)  # Qubit 0 is control, qubit 1 is target
```

## A More Interesting Example: Quantum Entanglement

Let's create a simple entangled state called a **Bell State**. 
This demonstrates one of the most mind-blowing aspects of quantum mechanics.

```python
from qiskit import QuantumCircuit, transpile
from qiskit_aer import AerSimulator
from qiskit.visualization import plot_histogram
import matplotlib.pyplot as plt

# Create a circuit with 2 qubits and 2 classical bits
qc = QuantumCircuit(2, 2)

# Create entanglement
qc.h(0)        # Put first qubit in superposition
qc.cx(0, 1)    # Entangle second qubit with first

# Measure both qubits
qc.measure([0, 1], [0, 1])

# Draw the circuit
print(qc.draw())

# Simulate with multiple shots to see the distribution
simulator = AerSimulator()
compiled_circuit = transpile(qc, simulator)
result = simulator.run(compiled_circuit, shots=1000).result()

# Get and display results
counts = result.get_counts()
print(f"Results: {counts}")

# Visualize
plot_histogram(counts)
plt.savefig('bell_state_results.png')
plt.show()
```

### What Makes This Special?

When you run this circuit 1000 times (shots=1000), you'll get approximately:
- `00`: ~500 times (both qubits measured as 0)
- `11`: ~500 times (both qubits measured as 1)
- `01`: 0 times (never happens!)
- `10`: 0 times (never happens!)

Here's what's happening: Each individual measurement gives you a random result - sometimes `00`, sometimes `11`. 
But here's the quantum magic: **within each single measurement, the two qubits are always the same value**.

If you were to measure just the first qubit alone, you'd get a random 0 or 1 with 50/50 probability. 
Same for the second qubit alone (i.e., random 0 or 1). 
But when you measure them together, they're perfectly synchronized:
- When qubit 0 is measured as 0, qubit 1 will **always** be 0
- When qubit 0 is measured as 1, qubit 1 will **always** be 1

The qubits are **entangled** (i.e., their fates are linked). 
We never programmed any rule that says `"if first qubit is 0, make second qubit 0"`. 
That correlation emerges from the quantum entanglement created by our `H` and `CNOT` gates. 
This is quantum mechanics in action!

## Practical Example: Quantum Random Number Generator

Classical computers struggle to generate truly random numbers.
They use pseudo-random algorithms, which produce predictable sequences that eventually repeat.
Quantum computers generate true randomness naturally. 
Here is a quantum random number generator:
```python
from qiskit import QuantumCircuit, transpile
from qiskit_aer import AerSimulator

def quantum_random_number(num_bits):
    """Generate a truly random number using quantum mechanics"""

    # Create circuit with n qubits
    qc = QuantumCircuit(num_bits, num_bits)

    # Put all qubits in superposition
    for qubit in range(num_bits):
        qc.h(qubit)

    # Measure all qubits
    qc.measure(range(num_bits), range(num_bits))

    # Simulate
    simulator = AerSimulator()
    compiled_circuit = transpile(qc, simulator)
    result = simulator.run(compiled_circuit, shots=1).result()

    # Convert binary result to integer
    measured_bits = list(result.get_counts().keys())[0]
    random_number = int(measured_bits, 2)

    return random_number

# Generate random numbers
print(f"8-bit random number: {quantum_random_number(8)}")
print(f"16-bit random number: {quantum_random_number(16)}")
print(f"4-bit random number: {quantum_random_number(4)}")
```

Each run will give you a different truly random number between `0` and `2^n - 1`.

## Understanding the Simulator

The `AerSimulator` we've been using simulates quantum behavior on your classical computer. 
Here's what it's actually doing:

1. **State Vector**: Maintains a complex vector representing all possible quantum states
2. **Gate Operations**: Applies matrix operations to evolve the state
3. **Measurement**: Randomly collapses the state based on probability amplitudes

For n qubits, it needs to track 2^n complex numbers. 
This is why simulation becomes impractical beyond `~30 qubits` (i.e., you would need more memory than exists on Earth)!

## Common Pitfalls for Beginners

### 1. Forgetting to Measure

```python
# Wrong - no measurement!
qc = QuantumCircuit(1)
qc.h(0)
# You won't get any results

# Correct - include measurement
qc = QuantumCircuit(1, 1)
qc.h(0)
qc.measure(0, 0)  # Don't forget this!
```

### 2. Confusing Qubit and Bit Indices

```python
qc = QuantumCircuit(2, 2)
qc.h(0)
# Measure qubit 0 into classical bit 0
qc.measure(0, 0)  # First 0 is qubit, second 0 is classical bit
```

### 3. Not Using Enough Shots

```python
# Too few shots - you won't see the probability distribution clearly
result = simulator.run(compiled_circuit, shots=10).result()

# Better - enough shots to see the pattern
result = simulator.run(compiled_circuit, shots=1000).result()
```

## Resources for Learning More

- [Qiskit Textbook](https://qiskit.org/textbook/) - Comprehensive free online textbook
- [IBM Quantum Composer](https://quantum-computing.ibm.com/) - Visual circuit builder in your browser
- [Qiskit Documentation](https://qiskit.org/documentation/) - Official API docs
- [Quantum Computing Stack Exchange](https://quantumcomputing.stackexchange.com/) - Community Q&A

## Conclusion

Quantum programming is no longer reserved for physics PhDs with access to exotic hardware. 
With tools like Qiskit, you can start experimenting with quantum concepts right now on your laptop. 
While simulating quantum circuits has its limitations, it's the perfect way to learn the fundamentals before graduating to real quantum hardware.

In the next (hopefully :D) blog post, I would like to share my thoughts on asymmetric cryptography (i.e., public and private keys) via RSA algorithm.
Soooo, stay tuned!

---

*Enjoyed this introduction? Check out my other posts on formal verification, distributed systems, and software engineering.*