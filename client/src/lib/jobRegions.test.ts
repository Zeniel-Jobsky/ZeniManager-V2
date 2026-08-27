import { describe, expect, it } from 'vitest';

import { findJobRegionOption, JOB_REGION_CHILD_COUNT, JOB_REGION_PROVINCES } from './jobRegions';

describe('job region catalog', () => {
  it('contains every province with a unique stable code', () => {
    expect(JOB_REGION_PROVINCES).toHaveLength(17);
    expect(new Set(JOB_REGION_PROVINCES.map(item => item.code)).size).toBe(17);
    expect(JOB_REGION_PROVINCES.map(item => item.code)).toEqual([
      'seoul',
      'busan',
      'daegu',
      'incheon',
      'gwangju',
      'daejeon',
      'ulsan',
      'sejong',
      'gyeonggi',
      'gangwon',
      'chungbuk',
      'chungnam',
      'jeonbuk',
      'jeonnam',
      'gyeongbuk',
      'gyeongnam',
      'jeju',
    ]);
    expect(JOB_REGION_PROVINCES.map(item => item.label)).toEqual([
      '서울특별시',
      '부산광역시',
      '대구광역시',
      '인천광역시',
      '광주광역시',
      '대전광역시',
      '울산광역시',
      '세종특별자치시',
      '경기도',
      '강원특별자치도',
      '충청북도',
      '충청남도',
      '전북특별자치도',
      '전라남도',
      '경상북도',
      '경상남도',
      '제주특별자치도',
    ]);
  });

  it('provides a complete searchable city, county, and district catalog', () => {
    const children = JOB_REGION_PROVINCES.flatMap(item => item.children);
    expect(JOB_REGION_CHILD_COUNT).toBe(228);
    expect(new Set(children.map(item => item.code)).size).toBe(children.length);
    expect(JOB_REGION_PROVINCES.map(item => item.children.length)).toEqual([
      25, 16, 9, 10, 5, 5, 5, 0, 31, 18, 11, 15, 14, 22, 22, 18, 2,
    ]);
    for (const province of JOB_REGION_PROVINCES) {
      for (const child of province.children) {
        expect(child.code.startsWith(`${province.code}/`)).toBe(true);
        expect(child.provinceCode).toBe(province.code);
        expect(child.label).toBe(`${province.label} ${child.shortLabel}`);
      }
    }
    expect(findJobRegionOption('seoul/gangnam-gu')?.label).toBe('서울특별시 강남구');
    expect(findJobRegionOption('gyeonggi/suwon-si')?.label).toBe('경기도 수원시');
    expect(findJobRegionOption('daegu/gunwi-gun')?.label).toBe('대구광역시 군위군');
  });
});
