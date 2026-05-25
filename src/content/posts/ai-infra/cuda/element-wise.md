---
title: CUDA Element-wise 算子
published: 2026-05-25
updated: 2026-05-25
description: 整理 CUDA 逐元素算子的基础写法、显存带宽瓶颈、网格跨步循环以及向量化加载与存储。
tags: [CUDA, GPU, "AI infra"]
category: AI infra/cuda
draft: false
sourceLink: https://github.com/wonderful0life123/obsidian_note/blob/main/AI%20Infra/cuda/element%20wise%E7%AE%97%E5%AD%90.md
comment: true
---

# CUDA Element-wise 算子

共同核心在于：输出位置 i 的值仅取决于输入数据在同一位置 i 的值（单目运算）或对应位置 i 的值（双目运算），计算过程不涉及相邻位置数据的求和、滑动窗口或矩阵乘法。

对 GPU 而言，这就意味着：

1. 不需要共享内存

线程之间无需交换数据，也就不需要同步指令。

2. 不需要复杂索引计算

除了计算当前线程对应的全局偏移之外，没有额外的寻址开销。

一个典型的逐元素加法操作：`C[i] = A[i] + B[i]`。

- 计算量：1 次加法。
- 访存量：读取 A、读取 B、写入 C。共计 3 次显存操作（假设单精度浮点，每次 4 字节）。此时，计算访存比 = 1 FLOP / 12 Bytes ≈ 0.08 FLOP/Byte。而主流 GPU 的理论峰值计算访存比通常在 10~20 FLOP/Byte 以上。

> [!WARNING]
> 逐元素算子的瓶颈不在计算能力上，而在显存带宽上。因此，衡量一个 Element-wise 核函数好坏的指标不是 TFLOPs，而是它是否跑满了显存带宽。

## 基础版本

```cpp
// naive：一个线程只负责一个元素
__global__ void add_kernel(const float* A, const float* B, float* C, int N) {
    // 1. 计算全局线程索引
    int idx = blockIdx.x * blockDim.x + threadIdx.x;

    // 2. 边界保护
    if (idx < N) {
        // 3. 逐元素计算
        C[idx] = A[idx] + B[idx];
    }
}
```

启动配置：

```cpp
int threadsPerBlock = 256;
int blocksPerGrid = (N + threadsPerBlock - 1) / threadsPerBlock;
add_kernel<<<blocksPerGrid, threadsPerBlock>>>(d_A, d_B, d_C, N);
```

## 访存合并与对齐

GPU 的显存系统并非以单个字节或者单个浮点数为单位与核函数交互，而是以内存事务（Memory Transaction）为单位。

以常见的 NVIDIA GPU 架构为例，L2 缓存与显存控制器之间的最小传输单元通常为 32 字节。当 SM 发出一次全局内存访问请求时，硬件会尝试将同一 Warp 的所有请求合并成尽可能少的事务。

- 理想情况：一个 Warp 的 32 个线程访问连续且对齐的 32 个 float，也就是 128 字节，那么只需要发送 4 次 32 字节的事务，或者 1 次 128 字节的事务。
- 最坏情况：32 个线程访问的内存地址在显存各处，并不连续，那么一次 Warp 的访存操作最差为 32 次独立的事务。

由于单次事务的延迟高达数百个时钟周期，拆分事务意味着带宽利用率断崖式下跌，核函数则需要等待数据。

## 隐藏访存延迟

**网格跨步循环（Grid-Stride Loop）**

```cpp
__global__ void add_kernel_v2(const float* A, const float* B, float* C, int N) {
    // 起始索引
    int idx = blockIdx.x * blockDim.x + threadIdx.x;
    // 总线程数（网格跨度） 步长 = 总线程数
    int stride = gridDim.x * blockDim.x;

    // 跨步循环处理多个元素,每个线程处理多个元素
    for (int i = idx; i < N; i += stride) {
        C[i] = A[i] + B[i];
    }
}
```

跨步循环中，一个线程处理的数据在内存中是不连续的、分散的。

启动配置：

```cpp
int threadsPerBlock = 256;
int blocksPerGrid = 128 * 2;   // 故意只启动 SM 数量 × 若干倍，而非 N/256
add_kernel_v2<<<blocksPerGrid, threadsPerBlock>>>(d_A, d_B, d_C, N);
// 实际启动：<<<256, 256>>>
// 总线程数 = 256 × 256 = 65,536 个线程
```

```text
GPU 硬件结构：
┌─────────────────────────────────────────────┐
│  GPU Device                                  │
│  ┌─────────────────────────────────────┐    │
│  │  Grid (你的启动配置)                  │    │
│  │  ┌──────┐ ┌──────┐      ┌──────┐     │    │
│  │  │Block0│ │Block1│ ...  │Block255│    │    │
│  │  └──────┘ └──────┘      └──────┘     │    │
│  │     ↓        ↓              ↓         │    │
│  │   256个线程 256个线程      256个线程   │    │
│  └─────────────────────────────────────┘    │
│           ↓         ↓              ↓         │
│  ┌─────────────────────────────────────┐    │
│  │  SM0    SM1    SM2    ...    SM_n    │    │
│  │  (硬件调度器自动分配Blocks到SMs)      │    │
│  └─────────────────────────────────────┘    │
└─────────────────────────────────────────────┘
```

启动配置并不需要覆盖整个 N，而是可以让 gridSize 更小，这样每个线程就可以处理更多的数据。

## 向量化加载与存储

即使使用了 Grid-Stride Loop，每个线程每次循环依然只处理 1 个 float。而 GPU 的显存总线位宽通常是 32 字节（或更高），这意味着硬件有能力在一次事务中搬运更多数据。

因此我们可以在一次事务中批量进行加载数据。 CUDA 提供了内置的向量类型：`float2`、`float4`、`double2` 等。一个 `float4` 变量包含 4 个连续的 float，共 16 字节。使用它可以将 4 次 32-bit 访存合并为 1 次 128-bit 访存。

那我们要注意的就是**原本 idx 的计算方式，要进行换算**。

```cpp
__global__ void add_kernel_v3(const float* A, const float* B, float* C, int N) {
    // 向量化：一次处理 4 个元素
    const float4* A4 = reinterpret_cast<const float4*>(A);
    const float4* B4 = reinterpret_cast<const float4*>(B);
    float4* C4 = reinterpret_cast<float4*>(C);

    int idx = blockIdx.x * blockDim.x + threadIdx.x;
    int stride = gridDim.x * blockDim.x;

    // 以 float4 为单位循环
    for (int i = idx; i < N / 4; i += stride) {
        float4 a = A4[i];
        float4 b = B4[i];
        float4 c;
        c.x = a.x + b.x;
        c.y = a.y + b.y;
        c.z = a.z + b.z;
        c.w = a.w + b.w;
        C4[i] = c;
    }

    // 处理尾部不足 4 的剩余元素（略）
}
```

理论提升：内存访问次数减少 75%！
