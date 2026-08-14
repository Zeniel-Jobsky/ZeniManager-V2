# 상담 관리 시스템 디자인 아이디어

## 선택된 디자인 철학: 모던 웰니스 어드민

<response>
<text>
**Design Movement**: 모던 웰니스 미니멀리즘 (Modern Wellness Minimalism)

**Core Principles**:
1. 차분하고 신뢰감 있는 그린 계열 주색상 (#009C64) 중심의 색채 체계
2. 따뜻한 오프화이트 배경 (#F0EEE9)으로 눈의 피로를 줄이는 인터페이스
3. 명확한 정보 계층구조와 넓은 여백으로 데이터 가독성 극대화
4. 상담사/관리자 역할 구분이 명확한 사이드바 네비게이션

**Color Philosophy**:
- Primary: #009C64 (신뢰, 성장, 치유를 상징하는 에메랄드 그린)
- Background: #F0EEE9 (따뜻한 크림 화이트 - 딱딱하지 않은 친근함)
- Destructive: Tomato Red (#E53E3E) - 삭제/경고 액션
- Cancel: Light Gray (#E2E8F0) - 취소 액션
- Card: White (#FFFFFF) - 콘텐츠 카드
- Text: #1A202C (진한 차콜) / #718096 (보조 텍스트)

**Layout Paradigm**:
- 고정 사이드바 (240px) + 메인 콘텐츠 영역
- 상단 헤더 바: 사용자 프로필, 설정 버튼
- 카드 기반 대시보드 레이아웃
- 역할별 다른 사이드바 메뉴 구성 (상담자 vs 관리자)

**Signature Elements**:
1. 그린 계열 액센트 라인과 아이콘
2. 부드러운 그림자 카드 (shadow-sm, rounded-sm)
3. 상태 배지 (진행중, 완료, 대기 등)

**Interaction Philosophy**:
- 호버 시 미세한 배경색 변화
- 클릭 시 즉각적인 피드백
- 폼 유효성 검사 인라인 표시

**Animation**:
- 페이지 전환: fade-in (150ms)
- 사이드바 메뉴 활성화: 좌측 그린 바 슬라이드
- 카드 로드: stagger animation

**Typography System**:
- Font: Noto Sans KR (한국어 최적화)
- Heading: 700 weight, 1.2rem-1.8rem
- Body: 400 weight, 0.875rem-1rem
- Caption: 400 weight, 0.75rem, muted color
</text>
<probability>0.08</probability>
</response>

## 선택: 모던 웰니스 미니멀리즘
이 접근법을 채택하여 상담 관리 시스템에 적합한 신뢰감 있고 전문적인 인터페이스를 구현합니다.
