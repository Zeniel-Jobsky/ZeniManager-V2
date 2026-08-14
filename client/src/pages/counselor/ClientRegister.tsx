/**
 * Client Registration Page (상담자 등록)
 * Design: 모던 웰니스 미니멀리즘
 */
import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { toast } from 'sonner';
import { ChevronLeft, User, Phone, Mail, Calendar, Building2, Briefcase, BookOpen, Car, MapPin, Target, Home, FileText } from 'lucide-react';
import { usePageGuard } from '@/hooks/usePageGuard';
import { PARTICIPATION_TYPE_OPTIONS } from '@/const';
import { createClient } from '@/lib/api';
import { updateClientEmploymentSnapshotAndSync } from '@/lib/employmentSuccessCase';
import DaumPostcode from 'react-daum-postcode';
import { encrypt } from '@/lib/crypto'; // 암호화 유틸리티 추가
import './ClientRegister.css'; // 새로 생성한 시맨틱 CSS import

export default function ClientRegister() {
  const { canRender, user } = usePageGuard('counselor');
  const [, navigate] = useLocation();
  const STORAGE_KEY = 'zeni_client_register_draft';

  const [form, setForm] = useState({
    name: '',
    resident_id: '', // 뒷자리 (DB resident_id 컬럼용)
    res_id_front: '', // 앞자리 (입력용)
    res_id_back: '', // 뒷자리 (입력용)
    birth_date: '',
    phone: '',
    email: '',
    age: '',
    gender: 'M',
    address_1: '',
    address_2: '',
    has_car: false,
    can_drive: false,
    education_level: '',
    school: '',
    major: '',
    MBTI: '',
    businessType: '1',
    participationType: '',
    processStage: '초기상담',
    is_working_parttime: false,
    future_card_stat: false,
    capa: '',
    desired_job_1: '',
    desired_job_2: '',
    desired_job_3: '',
    desired_area_1: '',
    desired_area_2: '',
    desired_area_3: '',
    desired_payment: '',
    work_ex_desire: '',
    work_ex_intent_checkbox: false,
    work_ex_type: '',
    work_ex_company: '',
    work_ex_start: '',
    work_ex_end: '',
    work_ex_graduate: '',
    branch: '',
    hire_place: '',
    hire_type: '',
    hire_job_type: '',
    hire_payment: '',
    employment_date: '',
    notes: '',
  });

  const [loading, setLoading] = useState(false);
  const [showPostcode, setShowPostcode] = useState(false);
  const isEmploymentCompleted = form.processStage === '취업완료';

  const update = (field: string, value: any) => setForm(f => ({ ...f, [field]: value }));

  // 전화번호 자동 하이픈
  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, '').slice(0, 11);
    let formatted = raw;
    if (raw.length > 7) formatted = `${raw.slice(0, 3)}-${raw.slice(3, 7)}-${raw.slice(7)}`;
    else if (raw.length > 3) formatted = `${raw.slice(0, 3)}-${raw.slice(3)}`;
    update('phone', formatted);
  };

  // 주민등록번호 앞자리 입력 핸들러
  const handleResFrontChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/[^0-9]/g, '').slice(0, 6);
    update('res_id_front', raw);
  };

  // 주민등록번호 뒷자리 입력 핸들러
  const handleResBackChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/[^0-9]/g, '').slice(0, 7);
    update('res_id_back', raw);
    update('resident_id', raw); // 뒷자리를 resident_id 컬럼으로 매핑
  };

  // 생년월일 자동 하이픈 핸들러 (YYYY-MM-DD)
  const handleBirthDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, '').slice(0, 8);
    let formatted = raw;
    if (raw.length > 6) {
      formatted = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6)}`;
    } else if (raw.length > 4) {
      formatted = `${raw.slice(0, 4)}-${raw.slice(4)}`;
    }
    update('birth_date', formatted);

    // 8자리 완성 시 나이 자동 계산
    if (raw.length === 8) {
      const year = parseInt(raw.slice(0, 4), 10);
      const currentYear = new Date().getFullYear();
      const calculatedAge = currentYear - year;
      update('age', calculatedAge.toString());
    }
  };

  // 주민번호 앞자리 및 뒷자리 첫번째 자리 입력 시 성별, 생년월일, 나이 자동 계산
  useEffect(() => {
    if (form.res_id_front.length === 6 && form.res_id_back.length >= 1) {
      const front = form.res_id_front;
      const yearPrefixStr = front.substring(0, 2);
      const month = front.substring(2, 4);
      const day = front.substring(4, 6);
      const genderDigit = form.res_id_back.substring(0, 1);

      let yearPrefix = '19';
      if (['3', '4'].includes(genderDigit)) yearPrefix = '20';

      const fullYear = parseInt(yearPrefix + yearPrefixStr, 10);
      const birthDateStr = `${fullYear}-${month}-${day}`;

      let gender = form.gender;
      if (['1', '3'].includes(genderDigit)) gender = 'M';
      if (['2', '4'].includes(genderDigit)) gender = 'F';

      const currentYear = new Date().getFullYear();
      let calculatedAge = currentYear - fullYear;

      setForm(f => ({ ...f, birth_date: birthDateStr, age: calculatedAge.toString(), gender }));
    } else {
      // 정보가 불충분할 때 초기화 (선택 사항)
      // setForm(f => ({ ...f, birth_date: '', age: '', gender: 'M' }));
    }
  }, [form.res_id_front, form.res_id_back]);

  // Auto-save logic
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setForm(f => ({ ...f, ...parsed }));
        toast.info('이전에 작성 중이던 임시 저장 데이터를 불러왔습니다.', { duration: 3000 });
      } catch (e) {
        console.error('Failed to load draft:', e);
      }
    }
  }, []);

  useEffect(() => {
    // We only save if there is at least some data (e.g. name, phone, email, or resident id parts)
    if (form.name || form.phone || form.email || form.res_id_front || form.res_id_back) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(form));
    }
  }, [form]);

  const handleCompleteAddress = (data: any) => {
    let fullAddress = data.address;
    let extraAddress = '';

    if (data.addressType === 'R') {
      if (data.bname !== '') extraAddress += data.bname;
      if (data.buildingName !== '') extraAddress += (extraAddress !== '' ? `, ${data.buildingName}` : data.buildingName);
      fullAddress += (extraAddress !== '' ? ` (${extraAddress})` : '');
    }

    update('address_1', fullAddress);
    setShowPostcode(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.phone || !form.res_id_front || !form.res_id_back) {
      toast.error('이름, 연락처, 주민번호(앞/뒤)는 필수 입력 항목입니다.');
      return;
    }

    // 전화번호 형태 검증 010-XXXX-XXXX
    const phoneRegex = /^010-\d{4}-\d{4}$/;
    if (!phoneRegex.test(form.phone)) {
      toast.error('전화번호 형식이 올바르지 않습니다. (예: 010-1234-5678)');
      return;
    }

    if (isEmploymentCompleted && !form.hire_place.trim()) {
      toast.error('취업완료 상태로 등록하려면 취업처를 입력해주세요.');
      return;
    }

    setLoading(true);

    try {
      const createdClient = await createClient({
        name: form.name,
        resident_id: encrypt(form.res_id_back), // 뒷자리 암호화 적용
        birth_date: form.birth_date || null,
        age: form.age ? parseInt(form.age, 10) : null,
        gender: form.gender,
        phone: form.phone,
        email: form.email, // 추가된 이메일 필드 매핑
        address_1: form.address_1,
        address_2: form.address_2,
        has_car: form.has_car,
        can_drive: form.can_drive,
        education_level: form.education_level || null,
        school: form.school || null,
        major: form.major || null,
        MBTI: form.MBTI || null,
        business_type: form.businessType ? form.businessType : null,
        participation_type: form.participationType || null,
        participation_stage: form.processStage || null,
        is_working_parttime: form.is_working_parttime,
        future_card_stat: form.future_card_stat ? 1 : 0,
        capa: form.capa || null,
        desired_job_1: form.desired_job_1 || null,
        desired_job_2: form.desired_job_2 || null,
        desired_job_3: form.desired_job_3 || null,
        desired_area_1: form.desired_area_1 || null,
        desired_area_2: form.desired_area_2 || null,
        desired_area_3: form.desired_area_3 || null,
        desired_payment: form.desired_payment ? parseInt(form.desired_payment, 10) : null,
        work_ex_desire: form.work_ex_desire ? parseInt(form.work_ex_desire, 10) : null,
        work_ex_type: form.work_ex_type ? parseInt(form.work_ex_type, 10) : null,
        work_ex_company: form.work_ex_company || null,
        work_ex_start: form.work_ex_start || null,
        work_ex_end: form.work_ex_end || null,
        work_ex_graduate: form.work_ex_graduate ? parseInt(form.work_ex_graduate, 10) : null,
        memo: form.notes || null,
        counselor_id: user?.counselorId || null,
      } as any);

      let syncFailed = false;
      if (isEmploymentCompleted) {
        try {
          await updateClientEmploymentSnapshotAndSync(createdClient.id, {
            participationStage: form.processStage || null,
            desiredJob1: form.desired_job_1 || null,
            desiredJob2: form.desired_job_2 || null,
            desiredJob3: form.desired_job_3 || null,
            employmentType: form.hire_type || null,
            employmentCompany: form.hire_place || null,
            employmentJobType: form.hire_job_type || null,
            employmentSalary: form.hire_payment || null,
            employmentDate: form.employment_date || null,
            hireDate: form.employment_date || null,
          });
        } catch (syncError) {
          console.error('Failed to sync employment success case after registration:', syncError);
          syncFailed = true;
        }
      }

      toast.success(`${form.name}님이 등록되었습니다.`);
      if (syncFailed) {
        toast.warning('취업성사자 기록(유사도) 저장에 실패했습니다.');
      }
      localStorage.removeItem(STORAGE_KEY); // Clear draft on success
      navigate('/clients/list');
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || '상담자 등록 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  if (!canRender) return null;

  return (
    <div className="max-w-4xl mx-auto space-y-5 pb-12">
      {/* Header */}
      <div className="register_header">
        <button
          onClick={() => navigate('/clients/list')}
          className="register_back_btn"
        >
          <ChevronLeft size={18} />
        </button>
        <div>
          <h1 className="text-xl font-bold text-foreground">상담자 통합 등록</h1>
          <p className="text-sm text-muted-foreground mt-0.5">상세한 신규 상담자 정보를 입력하세요</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="register_form_container">
        {/* Section 1: Basic Info */}
        <section className="register_section">
          <h2 className="register_section_title">
            <User size={15} /> 기본 정보
          </h2>
          {/* Row 1: Name & Phone */}
          <div className="register_grid_2">
            <div>
              <label className="register_label">이름 <span className="text-destructive">*</span></label>
              <input
                type="text"
                value={form.name}
                onChange={e => update('name', e.target.value)}
                placeholder="홍길동"
                className="register_input"
              />
            </div>
            <div>
              <label className="register_label">연락처 <span className="text-destructive">*</span></label>
              <input
                type="tel"
                value={form.phone}
                onChange={handlePhoneChange}
                placeholder="010-0000-0000"
                maxLength={13}
                className="register_input"
              />
            </div>
          </div>

          {/* Row 2: Email (Full width) */}
          <div className="register_row">
            <label className="register_label">이메일</label>
            <input
              type="email"
              value={form.email}
              onChange={e => update('email', e.target.value)}
              placeholder="example@email.com"
              className="register_input"
            />
          </div>

          {/* Row 3: Resident ID (Full width) */}
          <div className="register_row">
            <label className="register_label">주민등록번호 <span className="text-destructive">*</span></label>
            <div className="register_field_group">
              <div className="register_flex_row">
                <input
                  type="text"
                  value={form.res_id_front}
                  onChange={handleResFrontChange}
                  placeholder="앞 6자리"
                  maxLength={6}
                  className="register_input text-center max-w-[120px]"
                />
                <span className="text-muted-foreground">-</span>
                <input
                  type="password"
                  value={form.res_id_back}
                  onChange={handleResBackChange}
                  placeholder="뒤 7자리"
                  maxLength={7}
                  className="register_input text-center max-w-[140px]"
                />

                {/* 계산된 정보 자동 노출 영역 */}
                {form.birth_date && (
                  <div className="register_info_badge">
                    <span className="register_badge_text register_badge_primary">
                      {form.gender === 'M' ? '남성' : '여성'}
                    </span>
                    <span className="register_badge_divider" />
                    <span className="register_badge_text register_badge_foreground">
                      {form.age}세
                    </span>
                    <span className="register_badge_divider" />
                    <span className="register_badge_text register_badge_muted">
                      {form.birth_date}
                    </span>
                  </div>
                )}
              </div>
              {!form.birth_date && (
                 <p className="register_hint_text">번호를 모두 입력하면 성별, 나이가 자동으로 산출됩니다.</p>
              )}
            </div>
          </div>

          <div className="register_row register_field_group">
            <label className="register_label">거주지 주소</label>
            <div className="register_flex_row">
              <input
                type="text"
                value={form.address_1}
                readOnly
                placeholder="도로명 주소를 검색하세요"
                className="register_input flex-1"
              />
              <button
                type="button"
                onClick={() => setShowPostcode(!showPostcode)}
                className="btn-secondary px-4 py-2 whitespace-nowrap"
              >
                {showPostcode ? '닫기' : '주소 검색'}
              </button>
            </div>
            {showPostcode && (
              <div className="border border-input rounded-sm overflow-hidden mb-2 relative z-10 w-full">
                <DaumPostcode onComplete={handleCompleteAddress} autoClose />
              </div>
            )}
            <input
              type="text"
              value={form.address_2}
              onChange={e => update('address_2', e.target.value)}
              placeholder="상세 주소 (동, 호수 등)"
              className="register_input"
            />
          </div>
        </section>

        {/* Section 2: Education & Skills */}
        <section className="register_section">
          <h2 className="register_section_title">
            <BookOpen size={15} /> 학력 및 부가정보
          </h2>

          {/* Row 1: Education */}
          <div className="register_grid_3">
            <div>
              <label className="register_label">최종 학력</label>
              <select
                value={form.education_level}
                onChange={e => update('education_level', e.target.value)}
                className="register_input"
              >
                <option value="">선택 안함</option>
                {['초졸', '중졸', '고졸', '전문대졸', '대졸', '석사', '박사'].map(v => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="register_label">학교명</label>
              <input
                type="text"
                value={form.school}
                onChange={e => update('school', e.target.value)}
                placeholder="OO대학교"
                className="register_input"
              />
            </div>
            <div>
              <label className="register_label">전공</label>
              <input
                type="text"
                value={form.major}
                onChange={e => update('major', e.target.value)}
                placeholder="경영학"
                className="register_input"
              />
            </div>
          </div>

          {/* Row 2: Personality & Others */}
          <div className="register_row">
            <div className="register_grid_3">
              <div>
                <label className="register_label">MBTI</label>
                <select
                  value={form.MBTI}
                  onChange={e => update('MBTI', e.target.value)}
                  className="register_input"
                >
                  <option value="">선택 안함</option>
                  {['ISTJ', 'ISFJ', 'INFJ', 'INTJ', 'ISTP', 'ISFP', 'INFP', 'INTP', 'ESTP', 'ESFP', 'ENFP', 'ENTP', 'ESTJ', 'ESFJ', 'ENFJ', 'ENTJ'].map(v => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="register_label flex items-center gap-1"><Car size={14} /> 차량/운전</label>
                <div className="register_toggle_group">
                  <button
                    type="button"
                    onClick={() => update('has_car', !form.has_car)}
                    className={`register_toggle_btn ${form.has_car ? 'active' : ''}`}
                  >
                    자차 보유
                  </button>
                  <button
                    type="button"
                    onClick={() => update('can_drive', !form.can_drive)}
                    className={`register_toggle_btn ${form.can_drive ? 'active' : ''}`}
                  >
                    운전 가능
                  </button>
                </div>
              </div>
              <div>
                <label className="register_label">기타 상태</label>
                <div className="register_toggle_group">
                  <button
                    type="button"
                    onClick={() => update('is_working_parttime', !form.is_working_parttime)}
                    className={`register_toggle_btn ${form.is_working_parttime ? 'active' : ''}`}
                  >
                    현재 알바 중
                  </button>
                  <button
                    type="button"
                    onClick={() => update('future_card_stat', !form.future_card_stat)}
                    className={`register_toggle_btn ${form.future_card_stat ? 'active' : ''}`}
                  >
                    내일배움카드
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Section 3: Job Requirements */}
        <section className="register_section">
          <h2 className="register_section_title">
            <Target size={15} /> 희망 취업 조건 & 일경험
          </h2>

          <div className="register_grid_3">
            <div className="register_field_group">
              <label className="register_sub_label">희망 직종 1</label>
              <input type="text" value={form.desired_job_1} onChange={e => update('desired_job_1', e.target.value)} className="register_input sm_padding" />
            </div>
            <div className="register_field_group">
              <label className="register_sub_label">희망 직종 2</label>
              <input type="text" value={form.desired_job_2} onChange={e => update('desired_job_2', e.target.value)} className="register_input sm_padding" />
            </div>
            <div className="register_field_group">
              <label className="register_sub_label">희망 직종 3</label>
              <input type="text" value={form.desired_job_3} onChange={e => update('desired_job_3', e.target.value)} className="register_input sm_padding" />
            </div>

            <div className="register_field_group">
              <label className="register_sub_label">희망 지역 1</label>
              <input type="text" value={form.desired_area_1} onChange={e => update('desired_area_1', e.target.value)} className="register_input sm_padding" />
            </div>
            <div className="register_field_group">
              <label className="register_sub_label">희망 지역 2</label>
              <input type="text" value={form.desired_area_2} onChange={e => update('desired_area_2', e.target.value)} className="register_input sm_padding" />
            </div>
            <div className="register_field_group">
              <label className="register_sub_label">희망 지역 3</label>
              <input type="text" value={form.desired_area_3} onChange={e => update('desired_area_3', e.target.value)} className="register_input sm_padding" />
            </div>
          </div>

          <div className="register_grid_3 register_row border-t border-border pt-3">
            <div className="register_field_group">
              <label className="register_label">희망 연봉 (만원)</label>
              <input type="number" value={form.desired_payment} onChange={e => update('desired_payment', e.target.value)} placeholder="3000" className="register_input" />
            </div>
            <div className="register_field_group">
              <label className="register_label">역량 레벨</label>
              <select value={form.capa} onChange={e => update('capa', e.target.value)} className="register_input">
                <option value="">미작성</option>
                <option value="A">A등급 (구직준비도 높음)</option>
                <option value="B">B등급 (구직역량 필요)</option>
                <option value="C">C등급 (취업의지 부족)</option>
                <option value="D">D등급 (심층상담 필요)</option>
              </select>
            </div>
            <div className="register_field_group">
              <label className="register_label">일경험 필요여부</label>
              <select value={form.work_ex_desire} onChange={e => update('work_ex_desire', e.target.value)} className="register_input">
                <option value="">선택 안함</option>
                <option value="1">필요</option>
                <option value="2">미필요</option>
                <option value="3">해당없음</option>
              </select>
            </div>
          </div>

          <div className="register_row">
            <label className="register_checkbox_label font-medium">
              <input type="checkbox" checked={form.work_ex_intent_checkbox} onChange={e => update('work_ex_intent_checkbox', e.target.checked)} className="register_checkbox" />
              참여의사 및 상세 정보 작성하기
            </label>
          </div>

          {form.work_ex_intent_checkbox &&
            <div className="bg-muted/30 p-4 border border-border rounded-sm register_field_group mt-3">
              <div className="register_grid_2">
                <div className="register_field_group">
                  <label className="register_label">일경험 유형</label>
                  <select value={form.work_ex_type} onChange={e => update('work_ex_type', e.target.value)} className="register_input sm_padding">
                    <option value="">유형 선택</option>
                    <option value="1">훈련연계형</option>
                    <option value="2">체험형</option>
                    <option value="3">인턴형</option>
                  </select>
                </div>
                <div className="register_field_group">
                  <label className="register_label">일경험 참여기업</label>
                  <input type="text" value={form.work_ex_company} onChange={e => update('work_ex_company', e.target.value)} className="register_input sm_padding" />
                </div>
              </div>
              <div className="register_grid_3">
                <div className="register_field_group">
                  <label className="register_sub_label">시작일</label>
                  <input type="date" value={form.work_ex_start} onChange={e => update('work_ex_start', e.target.value)} className="register_input sm_padding" />
                </div>
                <div className="register_field_group">
                  <label className="register_sub_label">종료일</label>
                  <input type="date" value={form.work_ex_end} onChange={e => update('work_ex_end', e.target.value)} className="register_input sm_padding" />
                </div>
                <div className="register_field_group">
                  <label className="register_sub_label">수료 여부</label>
                  <select value={form.work_ex_graduate} onChange={e => update('work_ex_graduate', e.target.value)} className="register_input sm_padding">
                    <option value="">확인 불가</option>
                    <option value="1">수료</option>
                    <option value="0">미수료</option>
                  </select>
                </div>
              </div>
            </div>
          }
        </section>

        {/* Section 4: Counseling Processing Info */}
        <section className="register_section">
          <h2 className="register_section_title">
            <Briefcase size={15} /> 사업 운영부서 정보
          </h2>

          <div className="register_grid_3">
            <div className="register_field_group">
              <label className="register_label">위탁 지점</label>
              <input
                type="text"
                value={form.branch}
                onChange={e => update('branch', e.target.value)}
                placeholder="서울 강남지점"
                className="register_input"
              />
            </div>
            <div className="register_field_group">
              <label className="register_label">참여 사업 유형</label>
              <select
                value={form.businessType}
                onChange={e => update('businessType', e.target.value)}
                className="register_input"
              >
                <option value="1">취업성공패키지</option>
                <option value="2">국민취업지원제도</option>
                <option value="3">청년도약계좌</option>
                <option value="99">기타</option>
              </select>
            </div>
            <div className="register_field_group">
              <label className="register_label">참여 유형 분류</label>
              <select
                value={form.participationType}
                onChange={e => update('participationType', e.target.value)}
                className="register_input"
              >
                <option value="">선택 안함</option>
                {PARTICIPATION_TYPE_OPTIONS.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="register_row register_field_group">
            <label className="register_label">상담 단계</label>
            <div className="register_toggle_group">
              {['초기상담', '심층상담', '취업지원', '취업완료', '사후관리'].map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => update('processStage', s)}
                  className={`register_toggle_btn ${form.processStage === s ? 'active' : ''}`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div className="register_row register_field_group">
            <label className="register_label">기타 특이사항 (메모)</label>
          <textarea
              value={form.notes}
              onChange={e => update('notes', e.target.value)}
              placeholder="내담자 특이사항, 초기진단 결과 등 전달 메모"
              rows={4}
              className="register_input resize-none"
            />
          </div>

          {isEmploymentCompleted && (
            <div className="rounded-sm border border-emerald-200 bg-emerald-50/70 p-4 space-y-4">
              <div>
                <div className="text-sm font-semibold text-foreground">취업 완료 정보</div>
                <p className="mt-1 text-xs text-muted-foreground">
                  취업완료 상태로 등록되는 대상자는 저장 직후 성공사례 검색용 snapshot 동기화가 실행됩니다.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1.5">취업처 <span className="text-destructive">*</span></label>
                  <input
                    type="text"
                    value={form.hire_place}
                    onChange={e => update('hire_place', e.target.value)}
                    placeholder="OO기업"
                    className="w-full px-3 py-2 rounded-sm border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5">취업 직무</label>
                  <input
                    type="text"
                    value={form.hire_job_type}
                    onChange={e => update('hire_job_type', e.target.value)}
                    placeholder="사무행정"
                    className="w-full px-3 py-2 rounded-sm border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5">취업 구분</label>
                  <input
                    type="text"
                    value={form.hire_type}
                    onChange={e => update('hire_type', e.target.value)}
                    placeholder="정규직"
                    className="w-full px-3 py-2 rounded-sm border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5">급여</label>
                  <input
                    type="text"
                    value={form.hire_payment}
                    onChange={e => update('hire_payment', e.target.value)}
                    placeholder="월 250만원"
                    className="w-full px-3 py-2 rounded-sm border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5">취업일</label>
                  <input
                    type="date"
                    value={form.employment_date}
                    onChange={e => update('employment_date', e.target.value)}
                    className="w-full px-3 py-2 rounded-sm border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              </div>
            </div>
          )}
        </section>

        {isEmploymentCompleted && (
          <section className="register_section">
            <h2 className="register_section_title">
              <Briefcase size={15} /> 취업 완료 정보
            </h2>
            <div className="rounded-sm border border-emerald-200 bg-emerald-50/70 p-4 space-y-4">
              <div>
                <div className="text-sm font-semibold text-foreground">취업 완료 정보</div>
                <p className="mt-1 text-xs text-muted-foreground">
                  취업완료 상태로 등록되는 대상자는 저장 직후 성공사례 검색용 snapshot 동기화가 실행됩니다.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1.5">취업처 <span className="text-destructive">*</span></label>
                  <input
                    type="text"
                    value={form.hire_place}
                    onChange={e => update('hire_place', e.target.value)}
                    placeholder="OO기업"
                    className="w-full px-3 py-2 rounded-sm border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5">취업 직무</label>
                  <input
                    type="text"
                    value={form.hire_job_type}
                    onChange={e => update('hire_job_type', e.target.value)}
                    placeholder="사무행정"
                    className="w-full px-3 py-2 rounded-sm border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5">취업 구분</label>
                  <input
                    type="text"
                    value={form.hire_type}
                    onChange={e => update('hire_type', e.target.value)}
                    placeholder="정규직"
                    className="w-full px-3 py-2 rounded-sm border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5">급여</label>
                  <input
                    type="text"
                    value={form.hire_payment}
                    onChange={e => update('hire_payment', e.target.value)}
                    placeholder="월 250만원"
                    className="w-full px-3 py-2 rounded-sm border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5">취업일</label>
                  <input
                    type="date"
                    value={form.employment_date}
                    onChange={e => update('employment_date', e.target.value)}
                    className="w-full px-3 py-2 rounded-sm border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Actions */}
        <div className="register_flex_row justify-end register_row pb-8">
          <button
            type="button"
            onClick={() => navigate('/clients/list')}
            className="btn-cancel px-6"
          >
            취소
          </button>
          <button
            type="submit"
            disabled={loading}
            className="btn-primary px-8 disabled:opacity-60 text-sm py-2.5"
          >
            {loading ? '등록 처리 중...' : '신규 상담자 DB 등록 확정'}
          </button>
        </div>
      </form>
    </div>
  );
}
