---
title: TileLang Ascend 编程笔记
published: 2026-05-15
description: 整理 TileLang DSL 在 Ascend NPU 场景下的基础语法、kernel 定义、数据类型、launch、循环控制和调度表达方式。
tags: [TileLang, Ascend, "AI infra"]
category: AI infra/telilang
draft: false
sourceLink: https://github.com/wonderful0life123/obsidian_note/blob/main/%E5%A4%A7%E6%A8%A1%E5%9E%8B%E7%AE%97%E6%B3%95/%E7%A1%AC%E4%BB%B6%E7%9B%B8%E5%85%B3/telilang/TileLang-ascend.md
comment: true
---

# TileLang Ascend 编程笔记

TileLang是一种面向tile（数据块）级别编程的DSL（领域特定语言），基于其数据块层级的抽象，使开发者能够以一种高级、可组合的方式表达和优化底层内核行为。TileLang可以让开发者显式控制内存分配、数据移动、布局和并行执行。

## 1. TileLang语法基础

本节介绍TileLang（tile-lang）领域特定语言（DSL）的核心语法基础，你将使用这种语言编写高性能的内核。重点介绍如何定义内核、表达迭代操作、在内存域之间移动数据，以及如何通过即时编译（JIT）运行内核。

### 3.1 kernel定义

TileLang kernel是基于TIR（TVM IR）生成的函数，用**`@T.prim_func`**来修饰。参数类型为`T.Tensor`或`T.Buffer`，包含了shape和dtype信息。

```python
@T.prim_func
def add_kernel(
    A: T.Tensor((N,), dtype),    # dtype could be 'float32'
    B: T.Tensor((N,), dtype),
    C: T.Tensor((N,), dtype),
):
    ...  # kernel body
```

shape除了可以是整形常量外，还可以是符号变量的形式表示，以支持动态信息传递。在TileLang中，支持两种符号变量的形式：

- **T.dyn[...]**

  这种方式对于符号变量的使用，在kernel体内通过buffer的shape信息来获取和使用

  ```python
  # 1) Annotation-only symbol; read the bound size via shape
  K = T.dyn['K']  # dtype defaults to int32
  @T.prim_func
  def foo(A: T.Tensor((K,), 'float32')):
      N = A.shape[0]
      for i in T.serial(N):
          ...
  ```

- **T.dynamic(name, dtype)**

   这种方式创建一个tir.Var，然后可以直接在后续的表达式和循环语句中使用该符号。

  ```python
  # 2) Explicit Var symbol usable in the body
  K = T.dynamic('K', 'int32')   # or T.dynamic('K') defaults to int32
  @T.prim_func
  def bar(A: T.Tensor((K,), 'float32')):
      for i in T.serial(K):
          ...
  ```

注意：

- T.symbolic(name, dtype) 是T.dynamic的一个已弃用的别名；建议使用T.dynamic。
- 在 `@jit`中, 具体的尺寸来自第一次调用时传入的实际张量参数.
- 注解中的符号不需要作为单独的kernel参数；TileLang 会从参数形状中绑定它们。

### 3.2 数据类型

dtype用于指定Tile的数据类型，支持的类型列表有：

```
float16, float32, bfloat16, int8, int16, int32, int64, uint8, uint16, uint32, uint64
```

### 3.3 kernel launch

**with T.Kernel(...)** 声明一个kernel运行上下文，并且创建数据tile block与逻辑核的绑定关系。对于Ascend NPU来说，对于每个block，返回一个（cid，vid)的元组。cid的范围为 [0,block_num), vid的范围为0或1。因为A2/A3的CV核配比可以为1:2或1:1, 可以通过vid指定当前vector的索引。

下面的代码片段对于(M, N)大小的数据块，切分为（block_M，block_N）大小的基本tile block，tile block的数量为m_num * n_num个，代码逻辑可以理解为多个并发的执行单元，每个单元处理一个tile block（针对每个tile block，又可以根据vector数量切分为1个或2个vector单元并发处理）。

```python
m_num = M // block_M
n_num = N // block_N
VEC_NUM = 2

@T.prim_func
def main(A: T.Tensor((M, N), dtype),
         B: T.Tensor((M, N), dtype),
         C: T.Tensor((M, N), dtype)):
    with T.Kernel(m_num * n_num, is_npu=True) as (cid, vid):
        ......
```

### 3.4 Loops和Control Flow

TileLang kernel支持标准Python语法中的if/elif/else条件语句。条件应该是TIR expression（例如：i < N），Python中的普通布尔值被视为编译时常量，并且会被折叠（即优化掉）。

```python
for i in T.serial(N):
    if i < N:            # TIR condition
        C[i] = A[i] + B[i]
    else:
        pass

# Ternary
x = (A[i] if i < N else 0)
```

TileLang支持多种循环表达形式。

- **Serial**

**T.serial**构造普通的for循环。

```python
for i in T.serial(N):
    ...                     # 0..N-1

for i in T.serial(0, N, 2):
    ...                     # 0, 2, 4, ...
```

- **Unroll**

**T.unroll**针对小循环次数进行循环展开。

```python
for k in T.unroll(K_TILE):
    acc += a[k] * b[k]
```

这是一种高级使用模式，TileLang 将展开提示传递给 TIR；专家用户可通过因子化或显式调节参数进行优化调优。

- **Parallel**（element-wise）

**T.Parallel**(ext0, ext1, ...)构建嵌套循环，这些循环能够很好地将Tile运算映射到逐元素操作。循环体通过一个for头接收所有索引：

- **运算操作**：

```python
# 一维运算场景
for i in T.Parallel(v_block):
    m_i[i] = T.max(m_i[i], m_i_prev[i])
```

```python
# 二维运算场景
for (i, j) in T.Parallel(v_block, d):
	acc_o_ub[i, j] /= T.exp(attn_sink_ub[i] - scores_max[i])
```

- **拷贝操作**：

```python
# GM -> UB 拷贝&计算场景
for i, j in T.Parallel(block_M // VEC_NUM, block_N):
	C[bx * block_M + vid * block_M // VEC_NUM + i, by * block_N + j] = T.exp(a_ub[i, j])
```

Developer模式调度原语章节会有详细介绍。

- **Pipelined**

**T.Pipelined**(iters, num_stages=...)可以进行计算/搬运的流水掩盖。

```python
for ko in T.Pipelined(T.ceildiv(K, BK), num_stages=3):
    T.copy(A[by * BM, ko * BK], A_s)   # stage: copy A tile
    T.copy(B[ko * BK, bx * BN], B_s)   # stage: copy B tile
    T.gemm_v0(A_s, B_s, C_f)           # stage: compute
```

三段式流水并行排布示意：

```
------------------------------------->
  stage1  |     stage2     |  stage3 
--------------------------------------
copy copy | copy copy copy | ---- ----
---- ---- | gemm gemm gemm | gemm gemm
--------------------------------------
```

Developer模式调度原语章节会有详细介绍。

- **Persistent**

**T.Persistent**(domain, wave_size, index, group_size=...)可以让数据在多个AI Core间负载更均衡，并且提高数据缓存的命中概率。

```python
for bx, by in T.Persistent([T.ceildiv(M, block_M), T.ceildiv(N, block_N)],
                    core_num, cid):
    ...
```

- **While loop**

TileLang支持while循环表达，循环条件需要是TIR expression。如果TileLang检测出死循环会编译报错。

```python
i = 0
while i < N:
    ...
    if done:
        break
    i += 1
```

**Break和Continue**

在T.serial/T.unroll/T.Parallel/while循环中，可以使用break/continue来退出整个循环或本次循环。
