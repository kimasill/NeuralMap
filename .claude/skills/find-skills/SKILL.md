---
name: find-skills
description: "how do I do X", "find a skill for X"처럼 스킬이 있을 법한 요구가 들어오면 스킬을 찾아 설치하도록 돕는다.
---

# Find Skills

이 스킬은 오픈 에이전트 스킬 생태계에서 스킬을 **발견·설치**하도록 돕는다.

## 언제 쓰나

사용자가:

- "X 어떻게 해?"(X가 흔한 작업일 가능성)
- "X용 스킬 찾아줘"
- "X 할 수 있어?"(전문화 역량이 필요한 경우)
- 에이전트 기능 확장에 관심을 보일 때

## Skills CLI (`npx skills`)

- `npx skills find [query]` - 키워드로 검색
- `npx skills add <package>` - 설치
- `npx skills check` - 업데이트 확인
- `npx skills update` - 전체 업데이트

## 추천 절차

1. **요구 파악**: 도메인/작업/반복성(자주 쓰는지) 확인
2. **검색**: `npx skills find <query>`
3. **품질 확인**: 출처/인기/유지보수 상태를 보고 추천
4. **설치 안내**: 필요한 설치 커맨드 제시

