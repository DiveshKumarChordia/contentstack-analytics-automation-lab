/**
 * Auto-remediation system for self-healing automation.
 * Detects and fixes common issues: missing locales, workflows, roles, content types.
 */

export class AutoRemediator {
  constructor(cmaClient, config = {}) {
    this.cmaClient = cmaClient
    this.logger = config.logger
    this.metrics = config.metrics
  }

  async createMissingLocale(stack, localeCode, localeData = {}) {
    try {
      if (this.logger) {
        this.logger.info(`Auto-remediation: creating missing locale ${localeCode}`, {})
      }

      const locale = await this.cmaClient.locale
        .create({
          code: localeCode,
          name: localeData.name || localeCode.toUpperCase(),
          fallbackLocale: localeData.fallbackLocale || 'en-us',
          ...localeData,
        })
        .then((r) => r.locale)

      if (this.logger) {
        this.logger.info(`Auto-remediation: locale created successfully`, {
          localeCode,
          localeUid: locale?.uid,
        })
      }

      if (this.metrics) {
        this.metrics.recordOperation('auto-remediation:create-locale', 'remediation', 0, true, {
          localeCode,
        })
      }

      return { success: true, locale }
    } catch (error) {
      if (this.logger) {
        this.logger.warn(`Auto-remediation: failed to create locale ${localeCode}`, {
          error: error.message,
        })
      }

      if (this.metrics) {
        this.metrics.recordOperation('auto-remediation:create-locale', 'remediation', 0, false, {
          localeCode,
          error: error.message,
        })
      }

      return { success: false, error }
    }
  }

  async createMissingWorkflow(stack, workflowData = {}) {
    try {
      if (this.logger) {
        this.logger.info(`Auto-remediation: creating missing workflow`, {
          workflowName: workflowData.name,
        })
      }

      const workflow = await this.cmaClient.workflow
        .create({
          name: workflowData.name || `Auto-${Date.now()}`,
          enabled: workflowData.enabled !== false,
          content_types: workflowData.content_types || [],
          admin_users: workflowData.admin_users || [],
          ...workflowData,
        })
        .then((r) => r.workflow)

      if (this.logger) {
        this.logger.info(`Auto-remediation: workflow created successfully`, {
          workflowName: workflow?.name,
          workflowUid: workflow?.uid,
        })
      }

      if (this.metrics) {
        this.metrics.recordOperation('auto-remediation:create-workflow', 'remediation', 0, true, {
          workflowName: workflow?.name,
        })
      }

      return { success: true, workflow }
    } catch (error) {
      if (this.logger) {
        this.logger.warn(`Auto-remediation: failed to create workflow`, {
          error: error.message,
        })
      }

      if (this.metrics) {
        this.metrics.recordOperation('auto-remediation:create-workflow', 'remediation', 0, false, {
          error: error.message,
        })
      }

      return { success: false, error }
    }
  }

  async createMissingContentType(stack, contentTypeData = {}) {
    try {
      if (this.logger) {
        this.logger.info(`Auto-remediation: creating missing content type`, {
          contentTypeUid: contentTypeData.uid,
        })
      }

      const contentType = await this.cmaClient.contentType
        .create({
          uid: contentTypeData.uid || `auto_${Date.now()}`,
          title: contentTypeData.title || contentTypeData.uid,
          schema: contentTypeData.schema || [
            {
              data_type: 'text',
              field_metadata: { allow_rich_text: false },
              uid: 'title',
              display_name: 'Title',
            },
          ],
          ...contentTypeData,
        })
        .then((r) => r.content_type)

      if (this.logger) {
        this.logger.info(`Auto-remediation: content type created successfully`, {
          contentTypeUid: contentType?.uid,
        })
      }

      if (this.metrics) {
        this.metrics.recordOperation('auto-remediation:create-content-type', 'remediation', 0, true, {
          contentTypeUid: contentType?.uid,
        })
      }

      return { success: true, contentType }
    } catch (error) {
      if (this.logger) {
        this.logger.warn(`Auto-remediation: failed to create content type`, {
          error: error.message,
        })
      }

      if (this.metrics) {
        this.metrics.recordOperation('auto-remediation:create-content-type', 'remediation', 0, false, {
          error: error.message,
        })
      }

      return { success: false, error }
    }
  }

  async addMissingRole(stack, roleData = {}) {
    try {
      if (this.logger) {
        this.logger.info(`Auto-remediation: adding missing role`, {
          roleUid: roleData.uid,
        })
      }

      const role = await this.cmaClient.role
        .create({
          uid: roleData.uid || `role_${Date.now()}`,
          name: roleData.name || roleData.uid,
          ...roleData,
        })
        .then((r) => r.role)

      if (this.logger) {
        this.logger.info(`Auto-remediation: role added successfully`, {
          roleUid: role?.uid,
          roleName: role?.name,
        })
      }

      if (this.metrics) {
        this.metrics.recordOperation('auto-remediation:add-role', 'remediation', 0, true, {
          roleUid: role?.uid,
        })
      }

      return { success: true, role }
    } catch (error) {
      if (this.logger) {
        this.logger.warn(`Auto-remediation: failed to add role`, {
          error: error.message,
        })
      }

      if (this.metrics) {
        this.metrics.recordOperation('auto-remediation:add-role', 'remediation', 0, false, {
          error: error.message,
        })
      }

      return { success: false, error }
    }
  }

  async publishEntry(entry) {
    try {
      if (this.logger) {
        this.logger.info(`Auto-remediation: republishing entry after locale fix`, {
          entryUid: entry.uid,
          contentTypeUid: entry.content_type_uid,
        })
      }

      const updated = await entry.publish()

      if (this.logger) {
        this.logger.info(`Auto-remediation: entry republished successfully`, {
          entryUid: updated.uid,
        })
      }

      if (this.metrics) {
        this.metrics.recordOperation('auto-remediation:republish-entry', 'remediation', 0, true, {
          entryUid: updated.uid,
        })
      }

      return { success: true, entry: updated }
    } catch (error) {
      if (this.logger) {
        this.logger.warn(`Auto-remediation: failed to republish entry`, {
          entryUid: entry.uid,
          error: error.message,
        })
      }

      if (this.metrics) {
        this.metrics.recordOperation('auto-remediation:republish-entry', 'remediation', 0, false, {
          entryUid: entry.uid,
          error: error.message,
        })
      }

      return { success: false, error }
    }
  }

  async autoFixLocalizationError(error, entry, targetLocale) {
    // Detect missing locale error
    if (
      error.message?.includes('locale') ||
      error.message?.includes('not found') ||
      error.status === 404
    ) {
      if (this.logger) {
        this.logger.info(`Auto-remediation: detected missing locale, attempting creation`, {
          targetLocale,
          entryUid: entry?.uid,
        })
      }

      const createResult = await this.createMissingLocale(null, targetLocale, {
        fallbackLocale: 'en-us',
      })

      if (createResult.success) {
        // Retry the operation after locale creation
        if (this.logger) {
          this.logger.info(`Auto-remediation: locale created, ready to retry operation`, {})
        }
        return { remediated: true, action: 'created-locale', createdLocale: targetLocale }
      }
    }

    return { remediated: false }
  }

  getSummary() {
    return {
      message: 'Auto-remediation system active',
      capabilities: [
        'create-missing-locale',
        'create-missing-workflow',
        'create-missing-content-type',
        'add-missing-role',
        'republish-entry-after-fix',
      ],
    }
  }
}
