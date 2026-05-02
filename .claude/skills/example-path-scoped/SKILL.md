---
name: example-path-scoped
description: .claude 설정·에이전트·프로젝트 스킬만 건드릴 때 참고하는 짧은 예시. paths 로 자동 로드 범위를 제한하는 패턴을 보여 준다.
paths:
  - ".claude/**"
---

이 스킬은 **`paths`가 `.claude/**`일 때만** 자동 로드될 수 있도록 만든 **예시**다.

- 긴 규약·표는 `references/` 등 별도 파일로 두고, 필요할 때만 `Read` 한다.
- 서브에이전트에 **꼭** 넣을 스킬만 골라 `skills:` 프리로드한다.

