# NeuralMap — Profiling & Memory-Strategy Comparison (Summary)

> 컨텍스트 효율 평가의 **요약 리포트**입니다. 전체 학술 버전은
> [`neuralmap-context-efficiency-evaluation.md`](./neuralmap-context-efficiency-evaluation.md)를 참고하세요.
> 이 문서의 모든 수치는 로컬 평가 스크립트(`pnpm eval:*`)의 **실제 출력**이며 동일 명령으로 재현할 수 있습니다.

## TL;DR

- **컨텍스트 토큰 6,426 → 356 (−94.5%)** — 240턴 합성 에이전트 트랜스크립트를 뉴런/시냅스 그래프로 압축.
- **품질 점수 1.00 — 8개 전략 중 1위.** 회수율·정밀도·계보를 동시에 만점으로 가져간 유일한 전략.
- **stale 충돌 0건.** 토큰을 더 적게 쓴 전략(요약 캐시 36토큰, 벡터-only 210토큰)도 모두 이전-상태 계보 또는 정밀도를 잃음.
- **Context Pack 합성 p95 6.46 ms** (25회 반복), 그래프 빌드 6.4 ms — 모델 호출 전 단계에서 무시 가능한 오버헤드.

## 평가 방법

가상의 에이전트가 240턴 동안 활동하며 등장인물 "Mina"의 상태를 반복적으로 갱신하는
시나리오를 결정론적으로 생성합니다. 평가 질의는 다음 세 가지 사실을 동시에 요구합니다.

| 요구 사실 | 정답 |
| --- | --- |
| 현재 착용 상태 (`current_wearing`) | navy coat |
| 지속 약속 (`durable_promise`) | silver key trust promise |
| 이전 상태 계보 (`predecessor_lineage`) | gray raincoat (← old hoodie) |

핵심은 "그냥 다 회수"가 아니라 **무엇이 현재이고 무엇이 과거인지 구분(temporal
disambiguation)** 하면서 적은 토큰으로 답하는 것입니다. 같은 트랜스크립트·같은 질의·같은
랭커를 8개 메모리 전략에 동일 적용하고, 회수율/정밀도/계보를 합쳐 품질 점수(1.0 만점)를 냅니다.

### 환경 / 재현

```bash
pnpm install
pnpm eval:neuron-synapse    # 토큰 압축 + 합성 지연 프로파일
pnpm eval:memory-compare    # 8개 메모리 전략 동일 기준 비교
```

- 로컬 결정론적 벤치마크 (상용 모델 API 대상 라이브 벤치마크 아님).
- 토큰은 추정치(estimator) 기반이며 전략 간 **동일 추정기**로 산출 → 상대 비교가 목적.
- `provider_prompt_cache` 행은 프로바이더 컨텍스트 캐싱 의미를 모델링: 반복 prefix의
  지연/비용은 줄이지만 **컨텍스트 윈도우 자체를 줄이거나 stale 사실을 제거하지는 못함.**

## 결과 1 — 토큰 압축 (`eval:neuron-synapse`)

| 항목 | 값 |
| --- | --- |
| 이벤트(턴) 수 | 240 |
| 그래프 규모 | 뉴런 249 / 시냅스 254 |
| 원문 트랜스크립트 추정 | 6,426 tokens |
| 압축 컨텍스트 추정 | **356 tokens** |
| 토큰 절감률 | **94.46%** |
| 현재 상태 회수 | `Wearing = navy coat`, `Promise = silver key trust promise` ✓ |

성능(반복 25회):

| 단계 | 값 |
| --- | --- |
| 그래프 빌드 | 6.37 ms |
| Current view | 5.40 ms |
| Neuron query | 1.62 ms |
| Traverse | 1.10 ms |
| Context Pack 합성 — p50 / **p95** / max | 4.45 / **6.46** / 8.48 ms |

## 결과 2 — 8개 전략 동일 기준 비교 (`eval:memory-compare`)

| 메모리 전략 | 컨텍스트 토큰 | 품질 | 계보 회수 | stale 충돌 |
| --- | ---: | ---: | :---: | :---: |
| Raw full context | 6,939 | 0.53 | ✗ | 있음 |
| Provider prompt-cache | 6,939 | 0.53 | ✗ | 있음 |
| Sliding window (40) | 1,163 | 0.45 | ✗ | 없음 |
| Sliding window (120) | 3,496 | 0.65 | ✗ | 없음 |
| Keyword RAG top-10 | 265 | 0.53 | ✗ | 있음 |
| Summary-cache snapshot | 36 | 0.65 | ✗ | 없음 |
| Vector-only RAG top-10 | 210 | 0.40 | ✗ | 있음 |
| **NeuralMap graph RAG** | **742** | **1.00** | **✓** | **0건** |

품질 점수 순위: **NeuralMap 1.00 (1위)** → sliding-120 / summary-cache 0.65 → raw /
prompt-cache / keyword 0.53 → sliding-40 0.45 → vector-only 0.40.

### 읽는 법

- **토큰만 보면** 요약 캐시(36)와 벡터-only(210)가 NeuralMap(742)보다 쌉니다.
- 하지만 둘 다 **이전-상태 계보·출처를 잃고**, 벡터-only는 stale한 `gray raincoat` /
  `old hoodie` 후보를 시간 구분 없이 섞어 정밀도가 0으로 떨어집니다.
- NeuralMap만 current-view + 시냅스 traversal + Context Pack 압축으로 **현재·약속·계보를
  모두 회수하면서 stale 충돌 0건**을 달성합니다 — 적정 토큰에서 유일하게 시간적 명확성 유지.

### Verdict (스크립트 자동 판정)

- ✅ NeuralMap 품질이 모든 실측 전략을 선도
- ✅ NeuralMap 품질 > vector-only
- ✅ NeuralMap 컨텍스트 토큰 < prompt-cache
- ✅ 요약 캐시는 더 싸지만 계보를 잃음
- ✅ NeuralMap Context Pack stale 충돌 0건

## 한계

- 합성·결정론적 시나리오이며 단일 질의 패턴 기준입니다. 실제 워크로드 분포와 다를 수 있습니다.
- 토큰은 추정기 기반 상대 비교이며 특정 토크나이저의 절대 청구 토큰과 다를 수 있습니다.
- 지연은 로컬 단일 머신 측정으로, 분산 배포/네트워크 비용은 포함하지 않습니다.

---

*Generated from `pnpm eval:neuron-synapse` and `pnpm eval:memory-compare` raw output. 시뮬레이션은
무작위 시드를 사용하므로 실행마다 수치가 소폭 달라질 수 있습니다(이 리포트는 한 회 실행 기준).*
