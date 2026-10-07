import { isEmploymentCompletedStage } from '@shared/const';

// Dashboard totals and the follow-up list must use the same criteria.
export function needsClientFollowUp(client: {
  follow_up?: boolean | null;
  participation_stage: string | null;
  retention_1m_yn: string | null;
}): boolean {
  return client.follow_up === true || (
    isEmploymentCompletedStage(client.participation_stage) &&
    client.retention_1m_yn === 'N'
  );
}
