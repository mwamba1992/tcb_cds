import { ALL_ROLES, PERMISSIONS, ROLES, isRole, permissionsForRole, requiresStepUp } from './roles';

describe('RBAC', () => {
  describe('role guard', () => {
    it('accepts every declared role', () => {
      for (const role of ALL_ROLES) {
        expect(isRole(role)).toBe(true);
      }
    });

    it('rejects anything else', () => {
      // A token carrying an unknown role must fail closed, not resolve to no
      // permissions and quietly proceed.
      expect(isRole('root')).toBe(false);
      expect(isRole('')).toBe(false);
      expect(isRole('INVESTOR')).toBe(false);
    });
  });

  describe('maker-checker', () => {
    it('never lets one role both prepare and approve a BoT submission', () => {
      for (const role of ALL_ROLES) {
        const held = permissionsForRole(role);
        const both =
          held.includes(PERMISSIONS.batchPrepare) && held.includes(PERMISSIONS.batchApprove);
        expect({ role, both }).toEqual({ role, both: false });
      }
    });

    it('gives preparing to the officer and approving to the supervisor', () => {
      expect(permissionsForRole(ROLES.opsOfficer)).toContain(PERMISSIONS.batchPrepare);
      expect(permissionsForRole(ROLES.opsSupervisor)).toContain(PERMISSIONS.batchApprove);
    });
  });

  describe('separation of duties', () => {
    it('gives an investor what they need to bid and nothing operational', () => {
      const investor = permissionsForRole(ROLES.investor);
      expect(investor).toContain(PERMISSIONS.bidPlace);
      expect(investor).toContain(PERMISSIONS.portfolioReadOwn);

      expect(investor).not.toContain(PERMISSIONS.bidReadAll);
      expect(investor).not.toContain(PERMISSIONS.batchPrepare);
      expect(investor).not.toContain(PERMISSIONS.kycDecide);
    });

    it('keeps the BoT observer read-only', () => {
      const observer = permissionsForRole(ROLES.botObserver);
      for (const permission of observer) {
        expect(permission.endsWith(':read')).toBe(true);
      }
    });

    it('never lets the system administrator touch bids, batches or settlement', () => {
      // ICT administers the platform; it does not operate the market. An admin who could
      // approve a batch could also create the user who prepared it.
      const admin = permissionsForRole(ROLES.systemAdmin);
      expect(admin).not.toContain(PERMISSIONS.bidPlace);
      expect(admin).not.toContain(PERMISSIONS.batchPrepare);
      expect(admin).not.toContain(PERMISSIONS.batchApprove);
      expect(admin).not.toContain(PERMISSIONS.settlementApprove);
    });

    it('keeps staff from placing bids', () => {
      for (const role of ALL_ROLES) {
        if (role === ROLES.investor) continue;
        expect(permissionsForRole(role)).not.toContain(PERMISSIONS.bidPlace);
      }
    });
  });

  describe('step-up requirement', () => {
    it('covers every permission that commits money', () => {
      expect(requiresStepUp(PERMISSIONS.bidPlace)).toBe(true);
      expect(requiresStepUp(PERMISSIONS.bidAmendOwn)).toBe(true);
      expect(requiresStepUp(PERMISSIONS.batchApprove)).toBe(true);
      expect(requiresStepUp(PERMISSIONS.settlementApprove)).toBe(true);
    });

    it('does not burden reads', () => {
      expect(requiresStepUp(PERMISSIONS.auctionRead)).toBe(false);
      expect(requiresStepUp(PERMISSIONS.portfolioReadOwn)).toBe(false);
      expect(requiresStepUp(PERMISSIONS.oversightRead)).toBe(false);
    });
  });
});
