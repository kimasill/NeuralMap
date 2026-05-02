# NeuralMap — Claude 작업공간

이 워크스페이스는 **Claude 기반 코딩 에이전트**(메인 세션이 조율, 서브에이전트 병렬 실행 가능)를 전제로 한다.

이 저장소에서 구현할 대상 설계도(단일 진실 소스):

- `S:\Project\AIControlPlane\agent_context_graph_framework_blueprint.md`

---

## 오케스트레이션 모델

### 1) 서브에이전트 (같은 세션, 권장 기본)

- 정의 위치: `.claude/agents/` (버전 관리 가능).
- **메인 에이전트 = 조율자**: 요구사항을 **경로가 겹치지 않는 슬라이스**로 나누고, 독립 작업마다 서브에이전트를 **동시에** 띄운다.
- 서브에이전트는 부모 세션의 “스킬 로드 상태”를 자동 상속하지 않으므로, 필요 스킬은 에이전트 정의(frontmatter)의 `skills:` 로 **프리로드**하거나, 프롬프트에 `SKILL.md` 경로와 `Read` 지시로 보완한다.

### 2) 이 저장소에 포함된 병렬용 에이전트(템플릿)

- `parallel-research`: 읽기 전용 탐색·근거 수집
- `parallel-implement`: 슬라이스 구현(파일 충돌 금지)
- `parallel-verify`: 테스트/린트/체크 실행(무수정)

또한 블루프린트 구현을 대비해 아래 역할 템플릿을 포함한다:

- `framework-architect`
- `context-pack-composer`
- `graph-ingest-builder`
- `graph-retriever`
- `graph-workbench-ui`
- `trace-validator`

---

## Skills CLI (`npx skills`) — 검색·추가

스킬을 **검색·추가**할 때는 [Skills CLI](https://skills.sh/docs/cli)를 사용한다.

- 검색: `npx skills find <query>`
- 설치: `npx skills add <package-or-url> --skill <skill-name>`

이 저장소는 `.claude/settings.json`에 `npx` 실행 권한을 허용해 둔다.

---

## 작업 원칙

- 저장소 규칙·스타일이 있으면 우선한다.
- 절차형 작업은 해당 `SKILL.md`를 읽고 진행한다 (`C:\Users\김성현\.claude\skills\...` 또는 `.claude/skills/...`).
- 블루프린트(`agent_context_graph_framework_blueprint.md`)는 구현/검증의 기준이다. 추측으로 계약을 바꾸지 않는다(필요 시 ADR로 결정).

