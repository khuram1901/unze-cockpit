# Graph Report - unze-cockpit  (2026-10-08)

## Corpus Check
- Large corpus: 765 files · ~901,136 words. Semantic extraction will be expensive (many Claude tokens). Consider running on a subfolder.

## Summary
- 4565 nodes · 11089 edges · 393 communities (157 shown, 236 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 83 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `9d850132`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Community 0
- Community 1
- Community 2
- Community 3
- Community 4
- Community 5
- Community 6
- Community 7
- Community 8
- Community 9
- Community 10
- Community 11
- Community 12
- Community 13
- Community 14
- Community 15
- Community 16
- Community 17
- Community 18
- Community 19
- Community 20
- Community 21
- Community 22
- Community 23
- Community 24
- Community 25
- Community 26
- Community 27
- Community 28
- Community 29
- Community 30
- Community 31
- Community 32
- Community 33
- Community 34
- Community 35
- Community 36
- Community 37
- Community 38
- Community 39
- Community 40
- Community 41
- Community 42
- Community 43
- Community 44
- Community 45
- Community 46
- Community 47
- Community 48
- Community 49
- Community 50
- Community 51
- Community 52
- Community 53
- Community 54
- Community 55
- Community 56
- Community 57
- Community 58
- Community 59
- Community 60
- Community 61
- Community 62
- Community 63
- Community 64
- Community 65
- Community 66
- Community 67
- Community 68
- Community 69
- Community 70
- Community 71
- Community 72
- Community 73
- Community 74
- Community 75
- Community 76
- Community 77
- Community 78
- Community 79
- Community 80
- Community 81
- Community 82
- Community 83
- Community 84
- Community 85
- Community 86
- Community 87
- Community 88
- Community 89
- Community 90
- Community 91
- Community 92
- Community 93
- Community 94
- Community 95
- Community 96
- Community 97
- Community 98
- Community 99
- Community 100
- Community 101
- Community 102
- Community 103
- Community 104
- Community 105
- Community 106
- Community 107
- Community 108
- Community 109
- Community 110
- Community 111
- Community 112
- Community 113
- Community 114
- Community 115
- Community 116
- Community 117
- Community 118
- Community 119
- Community 120
- Community 121
- Community 122
- Community 123
- Community 124
- Community 125
- Community 126
- Community 127
- Community 128
- Community 129
- Community 130
- Community 131
- Community 132
- Community 134
- Community 135
- Community 136
- Community 137
- Community 138
- Community 139
- Community 140
- Community 141
- Community 142
- Community 143
- Community 144
- Community 145
- Community 146
- Community 147
- Community 148
- Community 149
- Community 150
- Community 151
- Community 152
- Community 153
- Community 154
- Community 155
- Community 156
- Community 157
- Community 158
- Community 159
- Community 160
- Community 161
- Community 162
- Community 163
- Community 164
- Community 165
- Community 166
- Community 167
- Community 168
- Community 169
- Community 170
- Community 171
- Community 172
- Community 173
- Community 174
- Community 175
- Community 176
- Community 177
- Community 178
- Community 179
- Community 180
- Community 181
- Community 182
- Community 183
- Community 184
- Community 185
- Community 186
- Community 187
- Community 188
- Community 189
- Community 190
- Community 191
- Community 192
- Community 193
- Community 194
- Community 195
- Community 196
- Community 198
- Community 199
- Community 200
- Community 201
- Community 202
- Community 205
- Community 207
- Community 208
- Community 209
- Community 210
- Community 211
- Community 212
- Community 214

## God Nodes (most connected - your core abstractions)
1. `createServiceClient()` - 339 edges
2. `requireAuth()` - 302 edges
3. `authFetch()` - 243 edges
4. `next` - 176 edges
5. `formatDateUK()` - 132 edges
6. `logAction()` - 125 edges
7. `useMobile()` - 119 edges
8. `react` - 107 edges
9. `COLOURS` - 101 edges
10. `AuthWrapper()` - 95 edges

## Surprising Connections (you probably didn't know these)
- `handleSignoff()` --calls--> `authFetch()`  [EXTRACTED]
  app/accounts-tax/AccountsTaxDashboard.tsx → app/lib/supabase.ts
- `MonthCell()` --calls--> `formatDateUK()`  [EXTRACTED]
  app/admin/page.tsx → app/lib/dateUtils.ts
- `openManageFleet()` --calls--> `authFetch()`  [EXTRACTED]
  app/admin/page.tsx → app/lib/supabase.ts
- `openManageSolar()` --calls--> `authFetch()`  [EXTRACTED]
  app/admin/page.tsx → app/lib/supabase.ts
- `openManageUtility()` --calls--> `authFetch()`  [EXTRACTED]
  app/admin/page.tsx → app/lib/supabase.ts

## Import Cycles
- None detected.

## Communities (393 total, 236 thin omitted)

### Community 0 - "Community 0"
Cohesion: 1.00
Nodes (117): POST(), GET(), GET(), checkAmendPermission(), DELETE(), GET(), PATCH(), POST() (+109 more)

### Community 1 - "Community 1"
Cohesion: 1.00
Nodes (96): ArchivedDoc, Backup, AccountResult, BusySlot, CalendarPage(), HOURS, MEETING_TYPES, MeetingRequest (+88 more)

### Community 2 - "Community 2"
Cohesion: 1.00
Nodes (85): CaseDetail, CaseProgress(), CaseUpdate, daysBetween(), ENTITY_DISPLAY, ENTITY_ORDER, LegalCase, OFFENCE_TYPES (+77 more)

### Community 3 - "Community 3"
Cohesion: 1.00
Nodes (71): COMPANY_TABS, CompanyTab, ENTITY_DISPLAY, FEATURE_TABS, FeatureTab, MONTH_FULL, MONTH_NAMES, MonthEntry (+63 more)

### Community 4 - "Community 4"
Cohesion: 1.00
Nodes (56): POST(), POST(), POST(), GET(), notifyOtherParticipants(), POST(), dynamic, dynamic (+48 more)

### Community 5 - "Community 5"
Cohesion: 1.00
Nodes (72): AttentionItem, AuditEntry, BudgetRow, buildPerformanceRows(), Card(), CompanyFinanceData, CompanyFinancePanel(), currentMonthStart (+64 more)

### Community 6 - "Community 6"
Cohesion: 1.00
Nodes (55): checkCanManage(), GET(), POST(), checkCanManage(), GET(), POST(), GET(), getDriveLinks() (+47 more)

### Community 7 - "Community 7"
Cohesion: 1.00
Nodes (51): AuditDashboard(), card, HRAttendance(), Overview, StationRow, FilterSelect(), HRFilterOptions, MONTH_NAMES (+43 more)

### Community 8 - "Community 8"
Cohesion: 1.00
Nodes (54): POST(), GET(), GET(), findPdfParts(), saveCashSheetData(), savePdcBuckets(), saveToDatabase(), POST() (+46 more)

### Community 9 - "Community 9"
Cohesion: 1.00
Nodes (61): LegalCases(), deleteCase(), openCase(), saveEdit(), StatusBadge(), BackupsPage(), handleDownloadBackup(), handleDownloadDoc() (+53 more)

### Community 10 - "Community 10"
Cohesion: 1.00
Nodes (58): btnStyle, BudgetActualInput(), cancelBtnStyle, ChainBreak, DailyPosition, DeptBudget, DeptBudgetSummary, FinanceManager() (+50 more)

### Community 11 - "Community 11"
Cohesion: 1.00
Nodes (50): ID_TO_CODE, POST(), WorkItem, checkBankingAccess(), checkReadAccess(), COMPANY_ID_MAP, DELETE(), GET() (+42 more)

### Community 12 - "Community 12"
Cohesion: 1.00
Nodes (65): EscalationAlertSection(), FlowHCMLifecycleSection(), avatarGrad(), avatarInitials(), AvatarRing(), BOOKING_OPTIONS, CAL_COLORS, CalAttendee (+57 more)

### Community 13 - "Community 13"
Cohesion: 1.00
Nodes (50): admin_compliance, admin_eobi_payments, admin_fuel_log, admin_fuel_log_vehicle_date, admin_locations, admin_ntn_docs, admin_registrations, admin_restaurant_licences (+42 more)

### Community 14 - "Community 14"
Cohesion: 1.00
Nodes (44): folderit_account_map, folderit_inbox_files, folderit_resolution_invites, get_folderit_details(), get_folderit_summary(), idx_folderit_inbox_files_account, idx_folderit_invites_account, idx_folderit_invites_email_status (+36 more)

### Community 15 - "Community 15"
Cohesion: 1.00
Nodes (49): FragmentRow(), formatValue(), ColDef, DataTable(), DATE(), MODULE_GROUPS, ModuleKey, ModuleMeta (+41 more)

### Community 16 - "Community 16"
Cohesion: 1.00
Nodes (50): idx_pnl_ledger_lines_lookup, idx_pnl_line_items_lookup, pnl_allocation_pct, pnl_ledger_lines, pnl_line_items, pnl_uploads, pnl_validation_checks, pnl_kpi_summary() (+42 more)

### Community 17 - "Community 17"
Cohesion: 1.00
Nodes (20): audit_annual_plan_overview(), audit_daily_activities, audit_plan_processes, audit_process_rollup(), audit_stage_tasks, audit_stage_templates, idx_audit_stage_tasks_process, trg_audit_process_rollup (+12 more)

### Community 18 - "Community 18"
Cohesion: 1.00
Nodes (38): CONFLICT_COLUMNS, POST(), RestoreBody, GET(), POST(), htmlToText(), GET(), Booking (+30 more)

### Community 19 - "Community 19"
Cohesion: 1.00
Nodes (50): init(), loadNotifications(), ADMIN_EMAIL, assignableRoles(), canAccessAdminOps(), canAccessFolderit(), canAssignToCeos(), canChangePasswordFor() (+42 more)

### Community 20 - "Community 20"
Cohesion: 1.00
Nodes (50): GET, logSync(), mapPipelineStage(), MONTH_MAP, parseAnyFlwDate(), parseFlwDate(), parseLeaveDate(), POST() (+42 more)

### Community 21 - "Community 21"
Cohesion: 1.00
Nodes (46): AuthCallbackPage(), getLandingRoute(), MemberProfile, MyTasks(), load(), UserTask, PermOverrides, scopedToMemberEmail() (+38 more)

### Community 22 - "Community 22"
Cohesion: 1.00
Nodes (45): computeQuickLinks(), DEPT_PAGES, GET(), monthStartStr(), offsetStr(), QuickLink, todayStr(), canAccessAdminEntry() (+37 more)

### Community 23 - "Community 23"
Cohesion: 1.00
Nodes (42): BS_NOTES, BsDonut(), BsGrandTotal(), BsInsightsCard(), BsItem(), BsNoteLine, BsRow, BsSectionHeader() (+34 more)

### Community 24 - "Community 24"
Cohesion: 1.00
Nodes (37): AVATAR_COLOURS, avatarColour(), initials(), MemberLite, MiniSubtaskToggle(), addOne(), approveSubtask(), assignMember() (+29 more)

### Community 25 - "Community 25"
Cohesion: 1.00
Nodes (32): daysOverdue(), daysUntil(), ExecHeroBanner(), getMonthEndFromDate(), getMonthStartFromDate(), HomePage(), HomePageInner(), loadDashboard() (+24 more)

### Community 26 - "Community 26"
Cohesion: 1.00
Nodes (29): auth_letters_contractor_idx, auth_letters_po_idx, authority_letters, contractors, contractors_name_idx, dispatch_records, dispatch_records_date_idx, dispatch_records_letter_idx (+21 more)

### Community 27 - "Community 27"
Cohesion: 1.00
Nodes (40): ActiveTab, AuthorityLetter, AVATAR_GRADIENTS, avatarGradient(), Contractor, ContractorPerf, DispatchRecord, emptyContractor (+32 more)

### Community 28 - "Community 28"
Cohesion: 1.00
Nodes (38): AdminDataPage(), addLocation(), handleDownloadTemplate(), handleImport(), loadCompliance(), loadFuel(), loadLicences(), loadNtnDocs() (+30 more)

### Community 29 - "Community 29"
Cohesion: 1.00
Nodes (43): DashboardView(), loadAll(), getMonthEnd(), getMonthFromDate(), getMonthStart(), getMonthWeekNumber(), kickerStyle, KpiCard() (+35 more)

### Community 30 - "Community 30"
Cohesion: 1.00
Nodes (36): BsGrandTotal(), BsItem(), BsNoteLine, BsSectionHeader(), BsSpacer(), BsSubHeader(), BsSubtotal(), CheckDetail (+28 more)

### Community 31 - "Community 31"
Cohesion: 1.00
Nodes (41): ApprovalItem, BrowseAccount, BrowseFile, BrowseFolder, BrowseView(), loadAllFiles(), loadFolderContents(), loadRootFolders() (+33 more)

### Community 32 - "Community 32"
Cohesion: 1.00
Nodes (37): CAT_LABELS, EmpDetail, EmployeeDetailPanel(), EngagementBar(), initials(), ragColor(), STATUS_DOT, Summary (+29 more)

### Community 33 - "Community 33"
Cohesion: 1.00
Nodes (23): flw_employees, flw_salary_setup, departments_name_uq, flw_employees_company_idx, flw_employees_dept_idx, flw_employees_location_idx, resolve_flw_employee_links(), resolve_flw_employee_links() (+15 more)

### Community 34 - "Community 34"
Cohesion: 1.00
Nodes (34): GET(), maxDuration, runtime, AccountMapRow, AuditEntry, BAD_FILENAME_PATTERNS, daysSince(), fetchFolderFilesRecursive() (+26 more)

### Community 35 - "Community 35"
Cohesion: 1.00
Nodes (38): AnnualAuditPlan(), addProject(), addStep(), assignDailyTask(), assignTeam(), deleteProcess(), deleteStep(), loadTasks() (+30 more)

### Community 36 - "Community 36"
Cohesion: 1.00
Nodes (27): daily_sales_attachments_audit_after, daily_sales_attachments_limit, daily_sales_attachments_sale_idx, daily_sales_audit_after, daily_sales_audit_record_idx, daily_sales_audit_store_time_idx, daily_sales_before_insert, daily_sales_before_update (+19 more)

### Community 37 - "Community 37"
Cohesion: 1.00
Nodes (37): AddTxnInline(), CashSheetDetail, CashSheetSummary, CashSheetTab(), addDraftRow(), closeUpload(), deleteSheet(), deleteTxn() (+29 more)

### Community 38 - "Community 38"
Cohesion: 1.00
Nodes (37): handleSubmit(), loadData(), showMsg(), updateStatus(), quickAction(), logAction(), returnFromWaitingReply(), sendPwReset() (+29 more)

### Community 39 - "Community 39"
Cohesion: 1.00
Nodes (31): AccountsTaxDashboard(), addNewYear(), FilingCell(), getFiled(), handleFilingToggle(), handleSignoff(), handleStatusChange(), handleUnlockFiling() (+23 more)

### Community 40 - "Community 40"
Cohesion: 1.00
Nodes (26): bank_position_snapshots, companies, admin_categories, admin_spend, audit_findings, audit_plan_items, hr_strategy_goals, legal_notices (+18 more)

### Community 41 - "Community 41"
Cohesion: 1.00
Nodes (32): calcDueDateTime(), createTaskFromTelegram(), DAY_NAMES, extractDue(), fullName(), iso(), maxDuration, MemberRow (+24 more)

### Community 42 - "Community 42"
Cohesion: 1.00
Nodes (30): flw_advance_salary, flw_advance_salary_uq, flw_allowances, flw_allowances_uq, flw_deductions, flw_deductions_uq, flw_employee_exits, flw_exemptions (+22 more)

### Community 43 - "Community 43"
Cohesion: 1.00
Nodes (29): MEMBER_COMPANY_NAMES, ActiveTab, ALL_BUSINESS_UNITS, AVATAR_GRADIENTS, businessUnitsFor(), DepartmentOwner, DEPARTMENTS, DEPT_BUSINESS_UNITS (+21 more)

### Community 44 - "Community 44"
Cohesion: 1.00
Nodes (26): ActiveBadge(), COMPANY_COLOURS, COMPANY_ID_BY_NAME, CONSULTANTS, daysUntil(), EditForm, LEGAL_STAGES, normaliseCompanyName() (+18 more)

### Community 45 - "Community 45"
Cohesion: 1.00
Nodes (27): apiFetch(), ExcelImportPanel(), confirm(), getToken(), MONTHS, parseExcel(), pkr(), PreviewRow (+19 more)

### Community 46 - "Community 46"
Cohesion: 1.00
Nodes (22): audit_log, idx_audit_log_created_at, idx_audit_log_table, idx_audit_log_user, idx_audit_log_user_email, idx_breakage_entries_date, idx_breakage_entries_plant, idx_cash_pos_company_date (+14 more)

### Community 47 - "Community 47"
Cohesion: 1.00
Nodes (24): GET(), fileUrl(), GET(), maxDuration, runtime, AccessItem, FolderitRawItem, GET() (+16 more)

### Community 48 - "Community 48"
Cohesion: 1.00
Nodes (27): BREAKAGE_CHAIN, BRNH_HD_CHAIN, daysBetween(), fmt(), GET(), getOrCreateAlert(), getPhone(), IFPL_CHAIN (+19 more)

### Community 49 - "Community 49"
Cohesion: 1.00
Nodes (28): addMonths(), ALERT_TYPE_TO_PERIOD, ALERT_TYPE_TO_SECTION, AlertType, ANNUAL_COMPANY_ENTITIES, ANNUAL_ENTITIES, annualCompanyDeadlines(), annualPersonalDeadlines() (+20 more)

### Community 50 - "Community 50"
Cohesion: 1.00
Nodes (26): taskChaseMessage(), taskReminderMessage(), whatsappLink(), actionBtn(), BannerItem(), BannerSection(), daysOverdue(), daysUntil() (+18 more)

### Community 51 - "Community 51"
Cohesion: 1.00
Nodes (22): authedFetch(), CheckDetail, CheckIssue, chipBtn(), COMPANY_TABS, fmtM(), fmtPct(), Insight (+14 more)

### Community 52 - "Community 52"
Cohesion: 1.00
Nodes (23): AuditProgressCard(), MiniBar(), Overall, Pill(), Summary, TeamStat, DailyItem, DOC_SHORT (+15 more)

### Community 53 - "Community 53"
Cohesion: 1.00
Nodes (21): addInlineStylesToHtml(), bestMatch(), deptAccent(), extractHtmlSummarySection(), MeetingCard(), handleDelete(), handleSave(), MeetingsPage() (+13 more)

### Community 54 - "Community 54"
Cohesion: 1.00
Nodes (26): FINANCE_COMPANIES, MATRIX_LOCKED_EMAILS, PROTECTED_EMAILS, ACCESS_PACKS, AccessPack, ALL_BUS, DEPARTMENTS, DEPT_BUS (+18 more)

### Community 55 - "Community 55"
Cohesion: 1.00
Nodes (20): cleanName(), DATE_RULES, DateRule, extractDate(), extractPriority(), matchMemberByName(), ParsedVoiceTask, parseVoiceTask() (+12 more)

### Community 56 - "Community 56"
Cohesion: 1.00
Nodes (21): apiFetch(), DailySalesPage(), boot(), Header(), signOut(), submit(), SummaryCard(), validate() (+13 more)

### Community 57 - "Community 57"
Cohesion: 1.00
Nodes (17): btn(), busFor(), Field(), fullName(), MemberDrawer(), applyPack(), autoSave(), handlePwReset() (+9 more)

### Community 58 - "Community 58"
Cohesion: 1.00
Nodes (17): todayPakistanISO(), DispatchForm(), ErrorBanner(), ContractorGroup, ContractorRow(), DispatchModal(), DispatchTarget, expiryStatus() (+9 more)

### Community 59 - "Community 59"
Cohesion: 1.00
Nodes (17): customersForPlant(), ReceivablesInner(), addBill(), canDropOnStage(), deleteBill(), loadData(), markCollected(), moveToStage() (+9 more)

### Community 60 - "Community 60"
Cohesion: 1.00
Nodes (17): CATEGORIES, fin(), maxDuration, POST(), CATEGORIES, COMPANIES, fin(), maxDuration (+9 more)

### Community 61 - "Community 61"
Cohesion: 1.00
Nodes (14): get_guarantee_summary(), guarantee_facilities, guarantees, idx_guarantees_customer, idx_guarantees_expiry, idx_guarantees_facility_id, idx_guarantees_status, get_guarantee_summary() (+6 more)

### Community 62 - "Community 62"
Cohesion: 1.00
Nodes (20): CashRow, CEO_EMAILS, DigestEscalation, DigestMeetingApproval, DigestPayload, DigestTask, fmtNum(), fmtPct() (+12 more)

### Community 63 - "Community 63"
Cohesion: 1.00
Nodes (19): handleUpload(), BELOW_LINES, BRANCH_CANON, BRANCH_CASING, channelFor(), cleanBranch(), cleanLabel(), CORE_MAP (+11 more)

### Community 64 - "Community 64"
Cohesion: 1.00
Nodes (18): handleUpload(), parseIfplPnl(), BELOW, cleanLabel(), COGS_DETAIL, COMPANY_CONFIG, CORE_MAP, num() (+10 more)

### Community 65 - "Community 65"
Cohesion: 1.00
Nodes (19): AuditProject, AuditTasksPanel(), cycleStatus(), renderCard(), toggleExpand(), toggleShowCompletedSteps(), COMPANY_BADGE, CompanyBadge() (+11 more)

### Community 66 - "Community 66"
Cohesion: 1.00
Nodes (19): flw_attendance_daily, flw_leave_requests, flw_sync_log, get_flw_attendance_today(), get_flw_on_leave_today(), get_flw_sync_status(), get_flw_workforce_summary(), flw_disciplinary (+11 more)

### Community 67 - "Community 67"
Cohesion: 1.00
Nodes (19): AdminDashboard(), AdminSummary, Card(), CardTitle(), ComplianceBar(), ComplianceStat, fmtPKR(), KCard() (+11 more)

### Community 68 - "Community 68"
Cohesion: 1.00
Nodes (14): current_prices, holdings, portfolio_summary, price_history, get_portfolio_summary_as_of(), get_upcoming_dividends(), idx_stock_dividends_ex_date, idx_stock_dividends_ticker (+6 more)

### Community 69 - "Community 69"
Cohesion: 1.00
Nodes (12): idx_breakage_entries_date, idx_dispatch_entries_date, idx_machine_issues_status, idx_members_email, idx_production_entries_date, idx_receivables_stage, idx_receivables_status, idx_tasks_assigned_by (+4 more)

### Community 70 - "Community 70"
Cohesion: 1.00
Nodes (18): auditWarnings(), BsCheck, detectMonth(), FACE, FIELDS, findYearCol(), fmt(), IflParsed (+10 more)

### Community 71 - "Community 71"
Cohesion: 1.00
Nodes (9): avatarColour(), initials(), MentionTextarea(), detectMention(), handleChange(), NewTaskForm(), handleSubmit(), loadInitialData() (+1 more)

### Community 72 - "Community 72"
Cohesion: 1.00
Nodes (18): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+10 more)

### Community 73 - "Community 73"
Cohesion: 1.00
Nodes (17): CashSheet, ChainBreak, COMPANY_TABS, CompanyTab, currentMonthISO(), getMonthOptions(), pkr(), pktNowParts() (+9 more)

### Community 74 - "Community 74"
Cohesion: 1.00
Nodes (14): ibmPlexMono, inter, interTight, metadata, RootLayout(), sourceSans, viewport, applyVars() (+6 more)

### Community 75 - "Community 75"
Cohesion: 1.00
Nodes (16): card, CompanyRow, Dashboard, display, FilterOptions, GroupHRContent(), GroupHRGuarded(), GroupHRPage() (+8 more)

### Community 76 - "Community 76"
Cohesion: 1.00
Nodes (16): ArchivedConvListItem(), authedFetch(), avatarBg(), ChatPanel(), convDisplayName(), Conversation, ConvListItem(), convPhoto() (+8 more)

### Community 77 - "Community 77"
Cohesion: 1.00
Nodes (15): card(), EffBar(), EmpRow, initials(), KpiCard(), MyTeamPerformance(), PERIODS, STATUS_CONFIG (+7 more)

### Community 78 - "Community 78"
Cohesion: 1.00
Nodes (15): isLetterExpired(), ProductionForm(), currentEmail(), deleteEntry(), hasEntryFor(), load(), loadHistory(), loadPOs() (+7 more)

### Community 79 - "Community 79"
Cohesion: 1.00
Nodes (7): daily_sales_attachments_audit_after, daily_sales_attachments_limit, daily_sales_attachments_sale_idx, public.daily_sales_attachments, public.daily_sales_attachments_audit_trigger(), public.daily_sales_attachments_limit(), public.daily_sales_computed

### Community 80 - "Community 80"
Cohesion: 1.00
Nodes (15): ALL_FINDINGS, bySeverity, findingMd(), issueSummary, npmRaw, REPORT_FILE, results, RESULTS_DIR (+7 more)

### Community 81 - "Community 81"
Cohesion: 1.00
Nodes (15): computeFilingRows(), computeQuarterChips(), fiscalMonths(), fiscalYearStart(), QUARTERLY_ENTITIES, QUARTERS, RETURN_ROWS, ScheduleStatus (+7 more)

### Community 82 - "Community 82"
Cohesion: 1.00
Nodes (15): CalendarEvent, classifyLink(), collapse(), dedupe(), extractMeeting(), fuzzyKey(), MEETING_PATTERNS, mergeEvents() (+7 more)

### Community 83 - "Community 83"
Cohesion: 1.00
Nodes (15): auditWarnings(), BsCheck, BsNoteLine, BsParsed, detectMonth(), FIELD_MATCHERS, FieldMatcher, findBsSheet() (+7 more)

### Community 84 - "Community 84"
Cohesion: 1.00
Nodes (5): idx_pending_minutes_status, pending_minutes, get_notification_badge_counts(), public.get_notification_badge_counts(), public.get_notification_badge_counts()

### Community 85 - "Community 85"
Cohesion: 1.00
Nodes (13): ACTION_COLOURS, AuditLogPage(), ActionBadge(), handleFilterChange(), loadStats(), LogRow(), AuditStats, EMPTY_STATS (+5 more)

### Community 86 - "Community 86"
Cohesion: 1.00
Nodes (14): Branch, FormType, Location, MAINTENANCE_TYPES, MyTask, RecentFuel, RecentMaint, RecentSolar (+6 more)

### Community 87 - "Community 87"
Cohesion: 1.00
Nodes (10): daily_sales_import_batch_idx, daily_sales_store_date_active_unique, import_batches_store_month_idx, month_unlocks_month_store_idx, public.daily_sales, public.import_batches, public.is_month_locked(), public.month_unlocks (+2 more)

### Community 88 - "Community 88"
Cohesion: 1.00
Nodes (11): apiDir, findings, findRoutes(), OUT_DIR, OUT_FILE, ROOT, routes, sensitivePatterns (+3 more)

### Community 89 - "Community 89"
Cohesion: 1.00
Nodes (8): CalendarPageInner(), loadData(), loadFreeBusy(), submitRequest(), updateStatus(), dayLabel(), displayMemberName(), getWeekDates()

### Community 90 - "Community 90"
Cohesion: 1.00
Nodes (7): public.has_widget(), public.retail_store_for_user(), public.store_users, public.stores, store_users_one_primary, store_users_store_id_idx, stores_email_lower_unique

### Community 91 - "Community 91"
Cohesion: 1.00
Nodes (13): background_color, description, display, icons, name, orientation, scope, serviceworker (+5 more)

### Community 92 - "Community 92"
Cohesion: 1.00
Nodes (9): public.is_main_task_assignee(), public.task_subtask_assignees, public.tsa_check_subtask_belongs_to_task(), public.tsa_enforce_completed_lock(), tsa_check_subtask_task, tsa_enforce_completed_lock, tsa_member_email_idx, tsa_subtask_id_idx (+1 more)

### Community 93 - "Community 93"
Cohesion: 1.00
Nodes (7): member_permissions, idx_member_permissions_member_id, sync_member_permissions(), trg_sync_member_permissions, public.sync_member_permissions(), public.sync_member_permissions(), public.sync_member_permissions()

### Community 94 - "Community 94"
Cohesion: 1.00
Nodes (12): chat_bump_updated_at(), chat_conversations, chat_messages, chat_messages_conv_idx, chat_messages_created_idx, chat_participants, chat_participants_conv_idx, chat_participants_member_idx (+4 more)

### Community 95 - "Community 95"
Cohesion: 1.00
Nodes (7): public.has_widget(), public.retail_store_for_user(), public.store_users, public.stores, store_users_one_primary, store_users_store_id_idx, stores_email_lower_unique

### Community 96 - "Community 96"
Cohesion: 1.00
Nodes (12): CompanyRow, fmtDate(), HRRecruitment(), load(), KpiCard(), PipelineRow, PositionRow, RecruitmentData (+4 more)

### Community 97 - "Community 97"
Cohesion: 1.00
Nodes (11): num(), ParsedUnzePnl, parseUnzePnl(), PnlAllocationPct, PnlCheck, PnlLedgerLine, PnlLineItem, SECTION_HEADERS (+3 more)

### Community 98 - "Community 98"
Cohesion: 1.00
Nodes (6): daily_sales_audit_after, daily_sales_before_insert, daily_sales_before_update, public.daily_sales_before_insert(), public.store_opening_balances_audit_trigger(), store_opening_balances_audit_after

### Community 99 - "Community 99"
Cohesion: 1.00
Nodes (12): name, private, version, pdfjs-dist, react-dom, tailwindcss, @tailwindcss/postcss, @types/node (+4 more)

### Community 100 - "Community 100"
Cohesion: 1.00
Nodes (13): dependencies, @anthropic-ai/sdk, googleapis, mammoth, next, pdf-parse, pdfjs-dist, react (+5 more)

### Community 101 - "Community 101"
Cohesion: 1.00
Nodes (12): BankingPage(), entityBadge(), loadPayments(), openAddModal(), renderEntityBlock(), renderEobiSS(), renderSection(), savePayment() (+4 more)

### Community 102 - "Community 102"
Cohesion: 1.00
Nodes (8): PhotoCropModal(), apply(), clampOffset(), getDisplayH(), getDisplayW(), handleZoom(), onMouseMove(), onTouchMove()

### Community 103 - "Community 103"
Cohesion: 1.00
Nodes (9): backup, __dirname, env, envPath, outDir, outPath, supabase, TABLES (+1 more)

### Community 104 - "Community 104"
Cohesion: 1.00
Nodes (5): grepFiles(), walk(), OUT_DIR, OUT_FILE, ROOT

### Community 105 - "Community 105"
Cohesion: 1.00
Nodes (10): canViewFinance(), financeCompanies(), isSecondaryCEO(), HeaderButton(), isCardVisible(), MobileSidebarContent(), PanelItem(), SidebarLayout() (+2 more)

### Community 106 - "Community 106"
Cohesion: 1.00
Nodes (8): cash_sheet_summary, cash_sheet_transactions, cash_sheet_uploads, idx_cash_sheet_company_date, idx_cash_txn_company_date, idx_cash_txn_sheet_id, cash_sheet_continuity(), daily_cash_continuity()

### Community 107 - "Community 107"
Cohesion: 1.00
Nodes (9): FACE_VALUE_OVERRIDES, fetchPsxPayouts(), GET(), parseAnnouncedDate(), parsePayoutRow(), parsePayoutsHtml(), PayoutRow, stripTags() (+1 more)

### Community 108 - "Community 108"
Cohesion: 1.00
Nodes (9): excelDateToMonth(), ForecastCheck, ForecastRow, parseCashFlowForecast(), ParsedForecast, SKIP_LABELS, handleFile(), parseCSV() (+1 more)

### Community 109 - "Community 109"
Cohesion: 1.00
Nodes (8): customersForPlant(), fmtMoney(), ReceivablesSection(), addBill(), billStatus(), markCollected(), stageBudget(), workingDaysSince()

### Community 110 - "Community 110"
Cohesion: 1.00
Nodes (10): devDependencies, eslint, eslint-config-next, tailwindcss, @tailwindcss/postcss, @types/node, @types/react, @types/react-dom (+2 more)

### Community 111 - "Community 111"
Cohesion: 1.00
Nodes (8): buildEmailBody(), DivEntry, fmtPct(), fmtRs(), formatDatePKT(), GET(), SummaryStock, SummaryTotals

### Community 112 - "Community 112"
Cohesion: 1.00
Nodes (5): monthly_budgets, quarterly_forecasts, idx_budgets_budget_date, idx_cash_plan_plan_date, idx_members_company_id

### Community 113 - "Community 113"
Cohesion: 1.00
Nodes (6): meeting_tasks, meetings, idx_meeting_attendees_email, idx_meeting_attendees_meeting, meeting_attendees, idx_meetings_date

### Community 115 - "Community 115"
Cohesion: 1.00
Nodes (6): public.is_task_assignee(), public.is_task_creator(), public.owns_or_created_task(), public.task_assignees, task_assignees_member_email_idx, task_assignees_task_id_idx

### Community 116 - "Community 116"
Cohesion: 1.00
Nodes (7): ACTION_ITEM_SCHEMA_PREFORMATTED, ACTION_ITEM_SCHEMA_RAW, anthropic, BASE_SCHEMA_FIELDS, buildSchema(), POST(), @anthropic-ai/sdk

### Community 117 - "Community 117"
Cohesion: 1.00
Nodes (7): RecurringTasksPanel(), deleteTemplate(), handleAdd(), loadData(), memberName(), saveEdit(), toggleActive()

### Community 118 - "Community 118"
Cohesion: 1.00
Nodes (7): recruitment_positions, get_position_candidates(), get_recruitment_positions(), get_recruitment_summary(), recruitment_candidates, recruitment_positions_flw_key, get_flw_recruitment_funnel()

### Community 119 - "Community 119"
Cohesion: 1.00
Nodes (4): department_budgets, idx_dept_budget_month, get_collected_receivables_by_plant(), get_department_budget_summary()

### Community 121 - "Community 121"
Cohesion: 1.00
Nodes (6): public.lock_task_dates(), public.set_original_due_date(), public.stamp_task_completed_at(), tasks_lock_dates, tasks_set_original_due_date, tasks_stamp_completed_at

### Community 122 - "Community 122"
Cohesion: 1.00
Nodes (6): idx_task_subtasks_task_id, public.block_complete_with_open_subtasks(), public.stamp_subtask_completed_at(), public.task_subtasks, subtasks_stamp_completed_at, tasks_block_complete_with_open_subtasks

### Community 123 - "Community 123"
Cohesion: 1.00
Nodes (6): get_onboarding_summary(), hr_onboarding_completions, hr_onboarding_modules, hr_onboarding_quiz_questions, hr_onboarding_sections, set_hr_onboarding_modules_updated_at

### Community 124 - "Community 124"
Cohesion: 1.00
Nodes (7): idx_legal_case_updates_case, idx_legal_cases_entity, idx_legal_cases_status, legal_case_updates, legal_cases, trg_legal_cases_updated_at, update_legal_case_timestamp()

### Community 128 - "Community 128"
Cohesion: 1.00
Nodes (6): GET(), parseCSVLine(), parseDate(), parseIntVal(), parseNum(), POST()

### Community 129 - "Community 129"
Cohesion: 1.00
Nodes (5): ColMap, getGoogleAuth(), mapColumns(), POST(), syncSession()

### Community 130 - "Community 130"
Cohesion: 1.00
Nodes (6): buildDigestMessage(), DIGEST_RECIPIENTS, formatDate(), GET(), OPEN_STATUSES, pktToday()

### Community 131 - "Community 131"
Cohesion: 1.00
Nodes (4): findActiveManager(), MemberRow, routeWaitingReplyTask(), submitWaitingReply()

### Community 132 - "Community 132"
Cohesion: 1.00
Nodes (3): public.retail_store_for_user(), public.store_users_email_check(), store_users_email_match_check

### Community 134 - "Community 134"
Cohesion: 1.00
Nodes (6): get_td_calendar(), get_td_summary(), hr_td_attendees, hr_td_feedback, hr_td_sessions, set_hr_td_sessions_updated_at

### Community 135 - "Community 135"
Cohesion: 1.00
Nodes (5): extract(), FEEDS, fetchFeed(), GET(), timeAgo()

### Community 136 - "Community 136"
Cohesion: 1.00
Nodes (6): scripts, build, dev, lint, prebuild, start

### Community 137 - "Community 137"
Cohesion: 1.00
Nodes (3): get_receivable_aging_by_customer(), get_receivable_aging_totals(), get_receivable_rag_by_customer()

### Community 138 - "Community 138"
Cohesion: 1.00
Nodes (3): idx_task_due_date_history_task_id, public.task_due_date_history, tasks_log_due_date_change

### Community 139 - "Community 139"
Cohesion: 1.00
Nodes (3): public.get_tasks_department_breakdown(), public.get_tasks_kpi_summary(), public.get_tasks_team_stats()

### Community 141 - "Community 141"
Cohesion: 1.00
Nodes (3): public.get_tasks_department_breakdown(), public.get_tasks_kpi_summary(), public.get_tasks_team_stats()

### Community 142 - "Community 142"
Cohesion: 1.00
Nodes (3): public.get_hr_company_performance(), public.get_hr_department_performance(), public.get_hr_performance_overview()

### Community 143 - "Community 143"
Cohesion: 1.00
Nodes (3): public.get_hr_company_performance(), public.get_hr_department_performance(), public.get_hr_performance_overview()

### Community 144 - "Community 144"
Cohesion: 1.00
Nodes (3): public.get_hr_company_performance(), public.get_hr_department_performance(), public.get_hr_performance_overview()

### Community 145 - "Community 145"
Cohesion: 1.00
Nodes (5): renderPayments(), entityBadge(), renderEntityBlock(), renderSection(), sectionBadge()

### Community 146 - "Community 146"
Cohesion: 1.00
Nodes (4): fetchPrice(), fetchPricePSX(), fetchPriceYahoo(), GET()

### Community 147 - "Community 147"
Cohesion: 1.00
Nodes (4): BillPicker(), handleInput(), search(), select()

### Community 148 - "Community 148"
Cohesion: 1.00
Nodes (4): GROUP_COLOURS, GROUP_ORDER, PAGE_REGISTRY, PageCard

### Community 150 - "Community 150"
Cohesion: 1.00
Nodes (4): config, decodeJwtPayload(), JwtPayload, middleware()

### Community 152 - "Community 152"
Cohesion: 1.00
Nodes (4): idx_tax_return_year, idx_tax_schedule_year, tax_return_filings, tax_schedule_entries

### Community 155 - "Community 155"
Cohesion: 1.00
Nodes (3): get_pdc_outlook(), idx_pdc_buckets_company_position, pdc_maturity_buckets

### Community 156 - "Community 156"
Cohesion: 1.00
Nodes (4): forecast_upload_checks, forecast_uploads, get_forecast_upload_log(), idx_forecast_uploads_company

### Community 157 - "Community 157"
Cohesion: 1.00
Nodes (4): generate_recurring_hr_tasks(), get_hr_tasks_summary(), hr_tasks, set_hr_tasks_updated_at

### Community 158 - "Community 158"
Cohesion: 1.00
Nodes (4): tax_schedule_audit, tax_schedule_audit_user, tax_schedule_audit_year_entity, tax_schedule_stage_durations

### Community 162 - "Community 162"
Cohesion: 1.00
Nodes (4): idx_kpi_alert_log_active, idx_kpi_alert_log_company, idx_kpi_alert_log_source, kpi_alert_log

### Community 163 - "Community 163"
Cohesion: 1.00
Nodes (3): WIDGET_PAGES, WIDGET_REGISTRY, WidgetDef

### Community 164 - "Community 164"
Cohesion: 1.00
Nodes (3): eslintConfig, eslint, eslint-config-next

### Community 168 - "Community 168"
Cohesion: 1.00
Nodes (3): idx_leave_dates, idx_leave_email, leave_records

### Community 179 - "Community 179"
Cohesion: 1.00
Nodes (3): get_pnl_restatements(), idx_pnl_restatements_company, pnl_restatements

### Community 180 - "Community 180"
Cohesion: 1.00
Nodes (3): get_offboarding_summary(), hr_offboarding_exits, set_hr_offboarding_exits_updated_at

### Community 181 - "Community 181"
Cohesion: 1.00
Nodes (3): folderit_user_map, folderit_user_map_account_idx, folderit_user_map_email_idx

### Community 183 - "Community 183"
Cohesion: 1.00
Nodes (3): get_realised_gains_by_ticker(), get_realised_gains_summary(), sell_transactions

### Community 185 - "Community 185"
Cohesion: 1.00
Nodes (3): faf_account_idx, faf_name_idx, folderit_all_files

## Knowledge Gaps
- **985 isolated node(s):** `session-end.sh script`, `ScheduleStatus`, `ReturnType`, `Quarter`, `ADMIN_EMAILS` (+980 more)
  These have ≤1 connection - possible missing edges. (Counts symbols only; 1718 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **236 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `next` connect `Community 4` to `Community 0`, `Community 128`, `Community 129`, `Community 130`, `Community 1`, `Community 3`, `Community 6`, `Community 135`, `Community 8`, `Community 7`, `Community 10`, `Community 11`, `Community 5`, `Community 2`, `Community 12`, `Community 15`, `Community 18`, `Community 146`, `Community 20`, `Community 21`, `Community 22`, `Community 150`, `Community 34`, `Community 39`, `Community 41`, `Community 47`, `Community 48`, `Community 56`, `Community 60`, `Community 62`, `Community 65`, `Community 67`, `Community 70`, `Community 74`, `Community 83`, `Community 99`, `Community 107`, `Community 111`, `Community 116`?**
  _High betweenness centrality (0.147) - this node is a cross-community bridge._
- **What connects `session-end.sh script`, `ScheduleStatus`, `ReturnType` to the rest of the system?**
  _985 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.03406772745818033 - nodes in this community are weakly interconnected._
- **Why does `createServiceClient()` connect `Community 0` to `Community 128`, `Community 129`, `Community 130`, `Community 4`, `Community 6`, `Community 8`, `Community 11`, `Community 18`, `Community 146`, `Community 20`, `Community 22`, `Community 34`, `Community 41`, `Community 47`, `Community 48`, `Community 49`, `Community 60`, `Community 62`, `Community 70`, `Community 83`, `Community 107`, `Community 111`?**
  _High betweenness centrality (0.048) - this node is a cross-community bridge._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.02857142857142857 - nodes in this community are weakly interconnected._
- **Why does `authFetch()` connect `Community 9` to `Community 1`, `Community 2`, `Community 3`, `Community 5`, `Community 7`, `Community 10`, `Community 12`, `Community 15`, `Community 21`, `Community 23`, `Community 24`, `Community 25`, `Community 27`, `Community 28`, `Community 30`, `Community 31`, `Community 32`, `Community 37`, `Community 38`, `Community 39`, `Community 43`, `Community 50`, `Community 53`, `Community 54`, `Community 55`, `Community 57`, `Community 58`, `Community 63`, `Community 67`, `Community 71`, `Community 73`, `Community 75`, `Community 77`, `Community 78`, `Community 86`, `Community 89`, `Community 96`, `Community 101`?**
  _High betweenness centrality (0.048) - this node is a cross-community bridge._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.03286034353995519 - nodes in this community are weakly interconnected._