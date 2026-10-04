# BATCH 11 - Discovery and release manifest

Base: 3572a70375317e7a532faf9be0fea93a6d8e3120. Map recorded before any implementation fix.

## Route inventory

- app/(auth)/login/page.tsx
- app/(auth)/reset-password/page.tsx
- app/(internal)/agent/activity/page.tsx
- app/(internal)/clientes/page.tsx
- app/(internal)/clientes/[id]/page.tsx
- app/(internal)/cobros/page.tsx
- app/(internal)/configuracion/page.tsx
- app/(internal)/costs/page.tsx
- app/(internal)/dashboard/page.tsx
- app/(internal)/empresas/page.tsx
- app/(internal)/facturas-venta/nueva/page.tsx
- app/(internal)/facturas-venta/page.tsx
- app/(internal)/flujo-caja/page.tsx
- app/(internal)/inventario/page.tsx
- app/(internal)/invoices/bulk/page.tsx
- app/(internal)/invoices/export/route.ts
- app/(internal)/invoices/page.tsx
- app/(internal)/invoices/revision/page.tsx
- app/(internal)/invoices/[id]/page.tsx
- app/(internal)/layout.tsx
- app/(internal)/licitaciones/auction-bot/page.tsx
- app/(internal)/licitaciones/auction-lab/page.tsx
- app/(internal)/licitaciones/auction-lab/[roomId]/page.tsx
- app/(internal)/licitaciones/competidores/page.tsx
- app/(internal)/licitaciones/competidores/[ruc]/page.tsx
- app/(internal)/licitaciones/documentos/page.tsx
- app/(internal)/licitaciones/page.tsx
- app/(internal)/licitaciones/prebid/page.tsx
- app/(internal)/licitaciones/[id]/page.tsx
- app/(internal)/licitaciones/[id]/prebid/page.tsx
- app/(internal)/notas-credito/page.tsx
- app/(internal)/ordenes-trabajo/page.tsx
- app/(internal)/ordenes-trabajo/[id]/page.tsx
- app/(internal)/orders/page.tsx
- app/(internal)/orders/[id]/page.tsx
- app/(internal)/pagos/nueva/page.tsx
- app/(internal)/pagos/page.tsx
- app/(internal)/pagos/[id]/page.tsx
- app/(internal)/planillas/[id]/page.tsx
- app/(internal)/precios/page.tsx
- app/(internal)/proformas/nueva/page.tsx
- app/(internal)/proformas/page.tsx
- app/(internal)/projects/page.tsx
- app/(internal)/projects/[id]/page.tsx
- app/(internal)/providers/page.tsx
- app/(internal)/providers/[id]/page.tsx
- app/(internal)/remisiones/nueva/page.tsx
- app/(internal)/remisiones/page.tsx
- app/(internal)/rfqs/page.tsx
- app/(internal)/rfqs/[id]/page.tsx
- app/(internal)/stock/export/route.ts
- app/(internal)/stock/nuevo/page.tsx
- app/(internal)/stock/page.tsx
- app/(internal)/stock/[id]/editar/page.tsx
- app/(internal)/stock/[id]/page.tsx
- app/(internal)/tesoreria/page.tsx
- app/(internal)/users/page.tsx
- app/(internal)/ventas/export/route.ts
- app/(internal)/ventas/nueva/page.tsx
- app/(internal)/ventas/nueva-nc/page.tsx
- app/(internal)/ventas/page.tsx
- app/(internal)/ventas/[id]/editar/page.tsx
- app/(internal)/ventas/[id]/page.tsx
- app/(print)/clientes/[id]/estado-cuenta/page.tsx
- app/(print)/pagos/[id]/imprimir/page.tsx
- app/(print)/ventas/[id]/imprimir/page.tsx
- app/api/agent/chat/route.ts
- app/api/agent/health/route.ts
- app/api/agent/status/route.ts
- app/api/agent/voice/session/route.ts
- app/api/agent/voice/stream/route.ts
- app/api/agent/voice/transcribe/route.ts
- app/api/apu-import/route.ts
- app/api/cron/climate-evaluation/route.ts
- app/api/cron/tender-monitoring/route.ts
- app/api/import-sessions/route.ts
- app/api/import-sessions/[id]/analyze/route.ts
- app/api/integrations/gmail/callback/route.ts
- app/api/integrations/gmail/connect/route.ts
- app/api/integrations/gmail/disconnect/route.ts
- app/api/integrations/gmail/status/route.ts
- app/api/planillas/route.ts
- app/api/planillas/[id]/confirmar/route.ts
- app/api/planillas/[id]/route.ts
- app/api/projects/[id]/certificado/[certId]/pdf/route.tsx
- app/api/projects/[id]/report/route.tsx
- app/api/recepcion-portal/[token]/route.ts
- app/api/scanner/claim/route.ts
- app/api/scanner/mobile-session/route.ts
- app/api/scanner/session/route.ts
- app/api/scanner/status/[id]/route.ts
- app/api/scanner/upload/route.ts
- app/api/warehouse-portal/[token]/route.ts
- app/api/workbook-interpretation/route.ts
- app/auction-lab/join/[token]/page.tsx
- app/auction-lab/watch/[token]/page.tsx
- app/avance/[token]/page.tsx
- app/certificados/[token]/page.tsx
- app/cotizacion/[token]/page.tsx
- app/cotizar/[token]/page.tsx
- app/recepcion/[token]/page.tsx
- app/scanner/layout.tsx
- app/scanner/page.tsx
- app/suspendido/page.tsx
- app/warehouse/[token]/page.tsx

## Candidate mutable/action/service inventory

Each row records concrete named exports, local auth wrappers and referenced tables/RPCs. Absence of a local wrapper does not prove an exposure: delegated authority, bearer tokens and database guards must be traced during audit. Client/local-cache/read paths remain explicitly visible.

| File | Named exports | Auth/client boundary | Tables | RPCs |
|---|---|---|---|---|
| app/(auth)/login/actions.ts | login | createClient |  |  |
| app/(auth)/login/page.tsx |  |  |  |  |
| app/(internal)/actions.ts | logout | createClient |  |  |
| app/(internal)/agent/activity/actions.ts | cancelAgentTaskAction, cancelAgentTaskFormAction | createClient, requireProfile |  |  |
| app/(internal)/agent/approval-actions.ts | decideApprovalAction, sendPreparedEmailAction, approveAndExecuteEmailApprovalAction, cancelEmailDraftAction, executeApprovalAction, processApprovalDecidedEvent | createClient, createAdminClient, requireProfile | email_drafts, agent_approvals, agent_events | cancel_email_approval_for_draft |
| app/(internal)/clientes/actions.ts | createClientRecord, updateClientRecord, toggleClientActive | createClient, requireModule | clients |  |
| app/(internal)/clientes/page.tsx |  | requireModule, createClient | clients |  |
| app/(internal)/clientes/section-action.ts | getClientesData | requireModule, createClient | clients |  |
| app/(internal)/cobros/section-action.ts | getCobrosData | requireModule, createClient | sales_documents, clients, cuentas_financieras |  |
| app/(internal)/configuracion/actions.ts | updateEmpresaFields, updateEmpresaPlan, generateTemplate, saveTemplate, deleteTemplate | createClient, requireProfile | empresas |  |
| app/(internal)/dashboard/section-action.ts | getDashboardData |  |  |  |
| app/(internal)/empresas/actions.ts | createEmpresa, createEmpresaAdmin, toggleEmpresaActive, resetUserPassword, toggleUserActive, deleteUser | createAdminClient, requireSuperAdmin | empresas, profiles |  |
| app/(internal)/flujo-caja/gastos-actions.ts | crearGastoRecurrente, actualizarGastoRecurrente, setGastoRecurrenteActivo, eliminarGastoRecurrente | requireProfile, createClient | projects, cuentas_financieras, gastos_recurrentes |  |
| app/(internal)/inventory/actions.ts | createCanonicalReceipt, uploadReceiptEvidence, createReceiptPortalLink, createInventoryLocation, updateInventoryLocationName, setInventoryLocationActive, createWarehousePortalLink, revokeWarehousePortalLink, postCanonicalInventoryMovement, confirmCanonicalReceipt, updateWarehouseSubmissionLine, addManualWarehouseSubmissionLine, processWarehouseSubmission, confirmCanonicalWarehouseSubmission | createClient, createAdminClient, requirePlan | oc_recepciones, inventory_receipt_evidence, warehouse-evidence, authorized_orders, authorized_order_items, inventory_locations, projects, inventory_balances, warehouse_portal_links, inventory_movements, productos, warehouse_submission_lines, warehouse_submissions, budget_items, warehouse_submission_evidence | create_receipt_portal_link, inventory_add_manual_warehouse_submission_line |
| app/(internal)/invoices/actions.ts | reconcilePendingInvoices, createInvoice, getCandidateOrders, linkInvoiceToOrder | createClient, createAdminClient, requireProfile | invoices, scan_sessions, attachments, invoice-files, invoice_order_matches, providers, authorized_orders |  |
| app/(internal)/invoices/bulk/bulk-form.tsx | BulkUploadForm | createClient | invoice_jobs, invoice-files |  |
| app/(internal)/invoices/extract-actions.ts | extractInvoiceFromPhoto | createClient, requireProfile |  |  |
| app/(internal)/invoices/revision/actions.ts | resolveInvoiceJob, retryInvoiceJob, discardInvoiceJob | createClient, createAdminClient, requireProfile | invoice_jobs, invoice-files, attachments, invoices |  |
| app/(internal)/invoices/revision/page.tsx |  | requireProfile, createClient | invoice_jobs, providers |  |
| app/(internal)/invoices/section-action.ts | getInvoicesData | requireProfile, createClient | providers, invoices, invoice_jobs |  |
| app/(internal)/invoices/[id]/actions.ts | matchOrder, unmatchOrder, approveException, markAptoParaPago, markAptoYCrearOp, deleteInvoice, getSignedInvoiceAttachmentUrl | createClient, createAdminClient, requireProfile, requireEmpresaId | invoice_order_matches, invoices, invoice_exceptions, payment_orders, payment_order_invoices, audit_logs, attachments | recompute_invoice_status, mark_invoice_apto_para_pago, next_op_code |
| app/(internal)/invoices/[id]/page.tsx |  | requireProfile, createClient | invoices, providers, invoice_order_matches, invoice_exceptions, payment_order_invoices, attachments |  |
| app/(internal)/licitaciones/actions.ts | importarLicitacion, setLicitacionDecision, dejarDeSeguirLicitacion, guardarPerfilLicitaciones, convertirLicitacionAProyecto, importarPlanillaCostosHistoricos, persistirEvaluacionComercial, generarPliegoOfertaCompleto, extraerRequisitosDePliego, extraerOfertasDeActa | requireProfile, createClient | empresas, empresa_licitacion_seguimiento, licitaciones, licitacion_lotes, licitacion_items, licitacion_oferentes, licitacion_documentos, licitacion_perfil, cost_observations, licitacion_ofertas | ingestar_proceso_ocds_global |
| app/(internal)/licitaciones/auction-lab/actions.ts | pollOperatorRoom, getOperatorRoomState, createSandboxRoom, startSandboxRoom, authorizeSandboxPolicy, authorizeAssistedBid, authorizeLimitBreachBid, declineLimitBreachBid, setSandboxBotPaused, finalizeSandboxRoom, regenerateSandboxLinks | requireEmpresaId, requireProfile, createClient, createAdminClient | auction_sandbox_policy_versions, auction_sandbox_rooms, auction_sandbox_participants | advance_sandbox_room, append_sandbox_event, submit_sandbox_bid, force_close_sandbox_room |
| app/(internal)/licitaciones/competidores/actions.ts | excluirCompetidoresRadar, restaurarCompetidoresRadar | requireProfile, createClient | empresa_competitor_exclusions |  |
| app/(internal)/licitaciones/competidores/competidores-radar-client.tsx | CompetidoresRadarClient |  |  |  |
| app/(internal)/licitaciones/documentos/actions.ts | crearDocumentoEmpresa, actualizarDocumentoEmpresa, eliminarDocumentoEmpresa | requireProfile, createClient | empresa_documentos, company_bid_vault_items |  |
| app/(internal)/ordenes-trabajo/[id]/page.tsx |  | requireModule, createClient | work_orders, clients, work_order_items, sales_documents |  |
| app/(internal)/orders/actions.ts | createManualOrder, createOrderFromInvoice, deleteOrder | createClient, createAdminClient, requireProfile, requireEmpresaId | invoices, invoice_order_matches, authorized_orders, audit_logs |  |
| app/(internal)/orders/direct-purchase-actions.ts | previewDirectPurchaseAction, confirmDirectPurchaseAction | requireProfile, createClient |  |  |
| app/(internal)/orders/oc-recepcion-actions.ts | registrarRecepcion, confirmarRecepcion, updateReceiptProductMapping, eliminarRecepcion | createClient, requirePlan, requireProfile | oc_recepciones, oc_recepcion_items | inventory_set_receipt_item_product |
| app/(internal)/orders/orders-filters.tsx | OrdersFilters |  |  |  |
| app/(internal)/orders/section-action.ts | getOrdersData | requireProfile, createClient | authorized_orders, providers |  |
| app/(internal)/orders/[id]/page.tsx |  | requireProfile, createClient, createAdminClient | authorized_orders, providers, invoice_order_matches, invoices, authorized_order_items, oc_recepciones, productos, inventory_receipt_evidence, warehouse-evidence |  |
| app/(internal)/pagos/actions.ts | createPaymentOrder, createPaymentOrderFromInvoice, markPaymentOrderExecuted | createClient, requireProfile | payment_orders, payment_order_invoices, invoices | next_op_code, ejecutar_orden_pago_atomica |
| app/(internal)/pagos/nueva/selection-form.tsx | SelectionForm |  |  |  |
| app/(internal)/pagos/section-action.ts | getPagosData | requireProfile, createClient | payment_orders, providers, payment_order_invoices |  |
| app/(internal)/precios/actions.ts | setMaterialPriceAction, linkPurchasesAutomaticallyAction, linkPurchaseDescriptionAction | createClient, requirePlan | productos, cost_observations |  |
| app/(internal)/projects/actions.ts | createProject, createProjectFromWorkbook, updateProjectStatus, updateProject, clearProjectSchedule, deleteProject, addBudgetItem, updateBudgetItem, deleteBudgetItem, deleteBudgetItems, addExecutionEntry, updateExecutionEntryPhotos, importBudgetItems, applyScheduleImport, updateBudgetItemSchedule, duplicateBudgetFromProject, getProjectNavInfo, getProjectsForSwitcher | createClient, createAdminClient, requirePlan | projects, audit_logs, budget_items, project_certificates, project_certificate_items, project_weather_log, execution_entries, certificate_workbooks, workbook_import_sessions, inventory_locations, execution_entry_photos |  |
| app/(internal)/projects/caterpillar-actions.ts | addLaborEntry, addSubcontractorContract, approveCertificate, rejectCertificate, listLaborPaymentsAction, addLaborPayment, deleteLaborPayment | createClient, requirePlan | projects, budget_items, labor_rates, daily_labor_entries, subcontractors, subcontractor_contracts, subcontractor_certificates, labor_payments | approve_subcontractor_certificate_atomically, reject_subcontractor_certificate_atomically |
| app/(internal)/projects/certificado-actions.ts | createCertificate, importCertificateWorkbook, bulkSetCertificatePresente, updateCertificateItem, updateCertificateDeductions, submitCertificate, verifyCertificate, approveCertificate, markCertificateInvoiced, revertCertificate, deleteCertificate, createProjectUnit, deleteProjectUnit, updateBudgetItemQuantityPerUnit, upsertCertificateUnitProgress, autoFillCertificateFromUnits, resyncCertificateFromExecution, getClientsForSelect, createSalesDocumentFromCertificate | createClient, requirePlan | project_certificate_items, project_certificates, projects, execution_entries, budget_items, project_units, project_certificate_unit_progress, clients, sales_documents, sales_document_items | import_project_certificate_atomically, resync_project_certificate_quantities_atomically |
| app/(internal)/projects/certificado-anexos-actions.ts | setWeatherDay, saveSchedulePlan, activateSchedulePlan, deleteSchedulePlan, addCertificateStaff, removeCertificateStaff | createClient, requirePlan | projects, project_certificates, project_weather_log, project_schedule_plans, project_schedule_plan_months, project_certificate_staff |  |
| app/(internal)/projects/certificado-workbook-actions.ts | attachCertificateWorkbook, saveCertificateWorkbookSnapshot, applyCertificateWorkbook, getCertificateWorkbook, getCertificateWorkbookDownloadUrl | createClient, requirePlan | project_certificates, certificate_workbooks, budget_items, project_certificate_items |  |
| app/(internal)/projects/climate-actions.ts | updateProjectClimateConfig, evaluateProjectWeatherDayAction, confirmWeatherWorkday, overrideWeatherWorkday, createRainEffectWorkday, updateLocalPrecipitation, createOtherWorkday, addClimateEvidence | createClient, requirePlan | projects, project_workday_status, climate_events, climate_evidence |  |
| app/(internal)/projects/historical-weather-actions.ts | getHistoricalWeatherAction | createClient, requirePlan | projects |  |
| app/(internal)/projects/import-session-actions.ts | getImportSession, saveImportSessionSnapshot, discardImportSession | createClient, requirePlan | workbook_import_sessions |  |
| app/(internal)/projects/production-recipe-actions.ts | listProductionRecipes, saveProductionRecipe, importProductionRecipe | createClient, createAdminClient, requirePlan | projects, production_recipes, production_recipe_components, budget_items |  |
| app/(internal)/projects/progress-forecast-actions.ts | runProgressForecastAction | createClient, requirePlan, createAdminClient | projects, budget_items, project_workday_status, execution_entries, budget_item_materials, inventory_stock_by_project, authorized_orders, oc_order_item_recibido, project_progress_forecast_runs | execution_save_forecast |
| app/(internal)/projects/weekly-plan-actions.ts | getWeeklyPlanDetailsAction, previewWeeklyPlanAction, saveWeeklyPlanAction | createClient, createAdminClient, requirePlan | project_weekly_plans, project_weekly_plan_items, inventory_reservations, projects | weekly_plan_project_sources, commit_weekly_plan_validated, commit_production_plan_atomic |
| app/(internal)/projects/weekly-plan-need-actions.ts | refreshWeeklyPlanNeedsAction | requirePlan, createClient, createAdminClient |  |  |
| app/(internal)/projects/[id]/apu-actions.ts | listLaborRatesAction, saveLaborRateAction, deleteLaborRateAction, listApuAction, saveBudgetItemMaterialAction, deleteBudgetItemMaterialAction, saveBudgetItemLaborAction, deleteBudgetItemLaborAction, saveBudgetItemEquipmentAction, deleteBudgetItemEquipmentAction, saveBudgetItemSubcontractAction, deleteBudgetItemSubcontractAction, getApuCostSummaryAction, getApuImportCatalogsAction, importApuMaterialsAction, importApuLaborAction, importApuEquipmentAction, importApuSubcontractsAction, applyApuTemplatesToProjectAction | createClient, requirePlan, createAdminClient | labor_rates, budget_item_labor, apu_template_labor, budget_item_materials, budget_item_equipment, budget_item_subcontracts, budget_items, productos, apu_templates, apu_template_materials, apu_template_equipment, apu_template_subcontracts |  |
| app/(internal)/projects/[id]/apu-templates-actions.ts | listApuTemplatesAction, deleteApuTemplateAction, importApuTemplateMaterialsAction, importApuTemplateLaborAction, importApuTemplateEquipmentAction, importApuTemplateSubcontractsAction, importApuPlanillaAction | createClient, requirePlan | apu_templates, apu_template_materials, apu_template_labor, apu_template_equipment, apu_template_subcontracts, productos, labor_rates, cost_observations |  |
| app/(internal)/projects/[id]/bim-actions.ts | getBimUploadSlot, registerBimModel, getBimData, generateMatchSuggestions, processBimGroups, getBimGroupsData, createBudgetItemsFromBimGroupsAction, confirmGroupMatch, rejectGroupMatch, confirmBimMatch, discardBimMatch, applyBimQuantityToBudgetItem, getBimModelFileUrl, deleteBimModel | createClient, requirePlan | projects, bim_models, bim_elements, budget_items, bim_budget_matches, bim_element_groups, bim_group_matches, bim-models | workspace_register_bim, execution_create_bim_partidas, execution_confirm_bim_group, workspace_apply_bim_quantity |
| app/(internal)/projects/[id]/computo-actions.ts | getComputoUploadSlot, importComputoExcel, importComputoPdf, retryComputoMatching, getComputoData, confirmComputoMatch, createBudgetItemsFromComputoAction, rejectComputoMatch, getComputoExportRows | createClient, requirePlan | projects, budget_items, computo_items, computo_item_matches, computo_imports, computo-imports |  |
| app/(internal)/projects/[id]/consumo-materiales-section.tsx | ConsumoMaterialesSection |  |  |  |
| app/(internal)/projects/[id]/costeo-actions.ts | listProjectsForCostRfqAction, createCostRfqsFromProject, getCostBudgetAction, getRealVsBudgetAction, setProjectCostPriceAction, clearProjectCostPriceAction | createClient, createAdminClient, requirePlan | projects, budget_items, budget_item_materials, productos, categorias_producto, provider_categorias, budget_item_labor, budget_item_equipment, budget_item_subcontracts, rfqs, execution_entries, inventory_consumption_by_budget, daily_labor_entries, labor_payments, subcontractor_certificates, project_cost_prices, quote_version_items, rfq_items, quote_versions, quotes, rfq_providers |  |
| app/(internal)/projects/[id]/presupuesto-table.tsx | PresupuestoTable |  |  |  |
| app/(internal)/projects/[id]/provider-actions.ts | linkProviderToProject, createProviderForProject, unlinkProviderFromProject | createClient, requireProfile | project_providers, providers |  |
| app/(internal)/providers/actions.ts | createProvider, updateProvider, toggleProviderActive | createClient, requireProfile | provider_categorias, providers |  |
| app/(internal)/providers/section-action.ts | getProvidersData | requireProfile, createClient | providers, categorias_producto, provider_categorias |  |
| app/(internal)/providers/[id]/actions.ts | getSignedUrl | requireProfile, createClient |  |  |
| app/(internal)/rfqs/actions.ts | uploadRfqAttachments, createRfq | createClient, createAdminClient, requireProfile | rfqs, rfq-attachments, attachments |  |
| app/(internal)/rfqs/section-action.ts | getRfqsData | requireProfile, createClient | rfqs |  |
| app/(internal)/rfqs/[id]/actions.ts | inviteProviders, getSignedAttachmentUrl, selectAndAuthorizeOffer, cancelRfq, reopenRfq, deleteRfq, enterQuotePricesManually | createClient, createAdminClient, requireProfile, requireEmpresaId | rfqs, rfq_providers, quotes, audit_logs | rfq_invite |
| app/(internal)/rfqs/[id]/workflow-actions.ts | openQuoteAttachmentAction, renewMagicLinkAction, closeDiscoveryAction, saveAllocationAction, authorizeAllocationAction, previewOrdersAction, confirmOrdersAction, extractQuoteDocumentAction, reviewQuoteAction, revokeMagicLinkAction, submitInternalQuoteAction | requireProfile, createClient, createAdminClient | attachments, rfq_providers |  |
| app/(internal)/stock/stock-actions.ts | crearProducto, actualizarProducto, desactivarProducto, reactivarProducto, registrarMovimiento, crearCategoria, renombrarCategoria, eliminarCategoria, crearDeposito, renombrarDeposito, eliminarDeposito, crearCategoriasSugeridas, importarProductos | createClient, requirePlan | productos, categorias_producto, depositos |  |
| app/(internal)/stock/stock-section.tsx | StockSection |  |  |  |
| app/(internal)/stock/[id]/page.tsx |  | requirePlan, createClient | productos, categorias_producto |  |
| app/(internal)/tesoreria/actions.ts | crearCuenta, actualizarCuenta, setCuentaActiva, registrarMovimientoManual, registrarTransferencia | requireProfile, createClient | cuentas_financieras | crear_cuenta_financiera_atomica, registrar_movimiento_tesoreria, registrar_transferencia |
| app/(internal)/users/actions.ts | createUser, updateUserRole, toggleUserActive | createClient, createAdminClient, requireProfile | profiles |  |
| app/(internal)/users/page.tsx |  | requireProfile, createClient | profiles |  |
| app/(internal)/ventas/actions.ts | createSalesDocument, updateSalesDocument, emitSalesDocument, voidSalesDocument, deleteSalesDocument, addReceipt, reverseReceipt | createClient, requireModule | sales_document_items, sales_documents, sales_receipts | registrar_cobro_atomico, revertir_cobro_atomico |
| app/(internal)/ventas/nueva-nc/page.tsx |  | requireModule, createClient | clients, sales_documents, sales_document_items |  |
| app/(internal)/ventas/sifen-actions.ts | emitirFE, emitirNC, consultarFE | requireModule, createClient | sales_documents, sales_document_items, empresas, clients | log_audit_event |
| app/(internal)/ventas/[id]/page.tsx |  | requireModule, createClient | sales_documents, clients, sales_document_items, sales_receipts, cuentas_financieras, sales_quotation_tokens, sales_quotation_events, work_orders, sales_quotation_acceptances |  |
| app/(internal)/ventas/[id]/quotation-actions.ts | createQuotationLink, logQuotationLinkCopied, revokeQuotationLink, updateQuotationExpiry, reopenQuotationToDraft, updateWorkOrderStatus, approveWorkOrderInternal | createClient, requireModule | sales_documents, sales_quotation_tokens, sales_quotation_events, work_orders |  |
| app/(internal)/ventas/_components/sales-list-section-action.ts | getSalesListData | requireModule, createClient | clients, sales_documents |  |
| app/api/integrations/gmail/callback/route.ts | GET | requireProfile, createClient, createAdminClient | email_oauth_states | email_connect_gmail |
| app/api/integrations/gmail/connect/route.ts | GET, POST | requireProfile, createClient | email_oauth_states |  |
| app/api/integrations/gmail/disconnect/route.ts | POST | requireProfile, createAdminClient | email_connections, email_send_attempts | email_read_oauth_secret_for_revoke, email_delete_oauth_secret |
| app/api/recepcion-portal/[token]/route.ts | POST |  | warehouse-evidence | submit_receipt_portal |
| app/api/warehouse-portal/[token]/route.ts | GET, POST | createAdminClient | warehouse_portal_links, inventory_locations, authorized_orders, warehouse-evidence, inventory_receipt_evidence, productos, budget_items, warehouse_submissions, warehouse_submission_evidence | inventory_portal_receipt, inventory_portal_consumption, inventory_apply_warehouse_upload_result |
| app/auction-lab/join/[token]/actions.ts | getJoinView, submitHumanBid | createAdminClient |  | advance_sandbox_room, submit_sandbox_bid, append_sandbox_event |
| app/auction-lab/token-gate.ts | resolveSandboxRoom | createAdminClient | auction_sandbox_rooms |  |
| app/auction-lab/watch/[token]/actions.ts | getWatchView | createAdminClient |  |  |
| app/avance/[token]/actions.ts | submitAvance | createAdminClient | projects, budget_items, execution_entries, execution-photos, execution_entry_photos |  |
| app/certificados/[token]/actions.ts | submitCertificate | createAdminClient | subcontractor_contracts, subcontractor_certificates, authorized_orders |  |
| app/cotizacion/[token]/actions.ts | acceptQuotationAction, rejectQuotationAction | createAdminClient |  | accept_quotation, reject_quotation |
| app/cotizacion/[token]/page.tsx |  | createAdminClient | sales_quotation_tokens, sales_documents, clients, empresas, sales_document_items | log_quotation_view |
| app/cotizar/[token]/actions.ts | submitMultiItemQuote, submitQuote, markOpened | createAdminClient | rfq_providers |  |
| app/scanner/components/camera-capture.tsx | CameraCapture |  |  |  |
| app/scanner/page.tsx |  |  |  |  |
| lib/agent/approvals.ts | canonicalJsonStringify, hashPayload, createApproval, getApproval, decideApproval, expireApproval, claimApprovalForExecution, markApprovalExecuted, markApprovalFailed, assertPayloadMatchesApproval, isApprovalDecided |  | agent_approvals |  |
| lib/agent/events.ts | buildDedupKey, emitAgentEvent, processAgentEvent |  | agent_events | process_agent_event |
| lib/agent/gateway.ts | gatewayExecute, gatewayExecuteSafe, executeApprovedTool |  | agent_steps | log_audit_event |
| lib/agent/leases.ts | claimTaskLease, renewTaskLease, releaseTaskLease, cleanupExpiredLeases |  | agent_task_leases |  |
| lib/agent/resume.ts | resumeTask, cancelTask |  | agent_tasks, agent_task_waits, agent_runs, agent_task_retries, agent_task_leases |  |
| lib/agent/retries.ts | computeBackoffMs, scheduleRetry, resolveOpenRetries, processDueRetries |  | agent_task_retries, agent_tasks |  |
| lib/agent/runtime.ts | createTask, getTask, listTasksForEmpresa, updateTaskStatus, createRun, finishRun, createStep, listStepsForRun, listStepsForTask |  | agent_tasks, agent_runs, agent_steps |  |
| lib/agent/timers.ts | processDueTimers |  | agent_task_waits |  |
| lib/agent/waits.ts | createTaskWait, satisfyTaskWait, cancelTaskWait, getTaskWaits, parkTaskForApproval, parkTaskForEvent, parkTaskForTimer, cancelWaitingWaitsForTask |  | agent_task_waits | replay_agent_event_to_wait |
| lib/auction-sandbox/tokens.ts | generateSandboxToken, hashSandboxToken, isValidSandboxTokenFormat |  |  |  |
| lib/audit.ts | logAudit |  |  | log_audit_event |
| lib/bim/ifc-viewer.client.ts | createIfcViewer |  |  |  |
| lib/cashflow/load.ts | loadCanonicalCashflow, readAll |  |  | cashflow_read_sources |
| lib/certificates/import-session-analysis.ts | runImportSessionAnalysis |  | workbook_import_sessions |  |
| lib/certificates/import-session-store.ts | createImportSession, loadImportSession, suggestContractRegime |  | workbook_import_sessions |  |
| lib/certificates/workbook-import.ts | extractCertificateWorkbookData, matchCertificateRows, buildCertificateImportLines, certificateWorkbookFingerprint |  |  |  |
| lib/certificates/workbook-store.ts | toStoredSheets, workbookFromSnapshot, computeStructureHash, mappingStillValid, createCertificateWorkbook, ensureSnapshotFormatting, loadCertificateWorkbook |  | certificate_workbooks |  |
| lib/cost-engine/index.ts | getCurrentCostEstimate, recordCostObservation | createClient | cost_observations |  |
| lib/costing/quote-version-service.ts | isAllowedQuoteAttachment, uploadQuoteAttachment |  | quote-pdfs, attachments |  |
| lib/documents/reader.ts | readDocumentContent, isSupportedMimeType, hashExtractedContent |  | attachments |  |
| lib/email/content-hash.ts | sha256Bytes, isSha256Digest, assertAttachmentDigest |  |  |  |
| lib/email/domain-service.ts | hashDraftContent, filterAttachmentsForProject, getEmailDraftPreview, prepareEmailDraft, buildSendEmailInput, getEmailDraftSendContext, getRecipientLabel, sendEmailDraft, recordEmailEvent, markEmailDraftWaitingApproval | createAdminClient | providers, clients, subcontractors, quote_versions, quotes, rfq_providers, rfqs, email_draft_attachments, attachments, empresas, projects, email_connections, email_drafts, email_send_events | cancel_email_approval_for_draft, claim_email_send, complete_email_send_attempt |
| lib/email/google-oauth.ts | googleOAuthConfig, hashOAuthState, createOAuthState, buildGoogleAuthorizationUrl, exchangeGoogleCode, fetchGoogleIdentity, revokeGoogleToken |  |  |  |
| lib/email/provider.ts | isSendableEmailConnectionStatus, prepareEmailAttachments | createAdminClient | email_connections | email_read_oauth_secret_for_send, mark_email_send_attempt_dispatching |
| lib/inventory/portal.ts | enforceWarehousePortalFileLimit, hashWarehousePortalToken, generateWarehousePortalToken, warehousePortalUrl, sha256Bytes |  |  |  |
| lib/inventory/receipt-portal.ts | hashReceiptPortalToken, isReceiptPortalToken, generateReceiptPortalToken, receiptPortalUrl, isReceiptPortalDate, isReceiptPortalEvidenceSignature, validateReceiptPortalLines |  |  |  |
| lib/inventory/service.ts | projectInventoryLocationName, ensureProjectInventoryLocation, postManualInventoryMovement, createInventoryReceipt, confirmInventoryReceipt, saveWarehouseSubmissionLinesAtomic, confirmWarehouseSubmission, getCanonicalInventorySnapshot, getProjectInventorySnapshot, getBudgetInventoryConsumption |  | inventory_locations, projects, inventory_stock_global_quantity, inventory_stock_by_location, inventory_stock_by_project, inventory_consumption_by_budget | inventory_post_manual_movement, inventory_create_receipt, inventory_confirm_receipt, inventory_save_submission_lines_atomic, inventory_confirm_warehouse_submission |
| lib/invoice-auto-match.ts | autoMatchInvoice, autoMatchInvoiceByAmount |  | authorized_orders, invoice_order_matches |  |
| lib/planillas/adapters/computo-presupuesto.ts |  |  | projects, budget_items | planilla_confirmar_computo |
| lib/planillas/service.ts | crearPlanilla, obtenerPlanilla, obtenerPlanilla, obtenerPlanilla, actualizarSnapshot, actualizarSnapshot, actualizarSnapshot, confirmarPlanilla, confirmarPlanilla, confirmarPlanilla | requireProfile, createClient | planillas |  |
| lib/procurement/bid-snapshot.ts | canonicalJsonStringify, generateSnapshotHash, createBidAnalysisSnapshot, verifySnapshotIntegrity, persistBidAnalysisSnapshot, getTenderAnalysisSnapshots |  | bid_analysis_runs |  |
| lib/procurement/climate-evaluation-runner.ts | runClimateEvaluationBatch |  | projects, audit_logs |  |
| lib/procurement/climate-workdays.ts | exceedsContractThreshold, externalClimateMeasurementPatch, evaluateProjectWeatherDay, localClimateMeasurementPatch, attachLocalPrecipitation |  | projects, climate_events, project_workday_status |  |
| lib/procurement/competitor-intelligence.ts | categorizarTamanoContrato, calcularCertezaEstadistica, calcularHuellaContextual, getCompetitorProfile, listCompetitorsRadar, listCompetitors |  | procurement_suppliers, licitacion_oferentes, procurement_bids, procurement_awards, procurement_award_suppliers, procurement_consortium_members, empresa_competitor_exclusions, v_procurement_competitor_global | get_competitor_radar_page |
| lib/procurement/contract-history.ts | classifyAmendment, separateContractsAndExtendsAmendments, computeContractEconomicHistory, calculateCompetitorBehaviorMetrics |  |  |  |
| lib/procurement/flywheel.ts | processFlywheelExecutionPurchase, validateInvoiceLineEvidence, recordCostObservationFromInvoice |  | authorized_orders, productos, cost_observations |  |
| lib/procurement/operational-analyst-llm.ts | calculateOperationalInputHash, createDegradedOperationalFallback, analyzeOperationalWorkability |  |  |  |
| lib/procurement/pbc-provenance.ts | createPbcSourceMetadata, isBidAnalysisSnapshotCurrent, assessTenderPbc |  |  |  |
| lib/procurement/send-rfq-service.ts | sendRfqDomainService |  | rfqs | rfq_invite |
| lib/procurement/tender-monitoring-runner.ts | runTenderMonitoringBatch |  | licitaciones, audit_logs |  |
| lib/procurement/tender-to-project.ts | buildProjectFromAdjudicatedTender, executeTenderToProjectTransaction, executeWinningTenderHandoff |  |  | prebid_create_project |
| lib/procurement/weekly-plan-shared.ts | aggregateProjectStockByProduct, toEngineTargets, translateTargetToQuantity, sumRequestedByItem, remainingForItem, isGroupingItem, selectBaselineCertificate, computeBaselineWithDeltas, loadWeeklyPlanBaseData, loadCentralAvailability, resolveWeeklyWeather | createAdminClient | projects, budget_items, project_certificates, project_certificate_items, execution_entries, budget_item_materials, budget_item_labor, budget_item_equipment, budget_item_subcontracts, inventory_stock_by_project, authorized_orders, oc_order_item_recibido, inventory_locations, inventory_stock_by_location, inventory_reservations, project_weather_forecast_batches, project_weather_forecast_snapshots |  |
| lib/quotation-tokens.ts | generateQuotationToken, hashQuotationToken, quotationTokenPrefix, isValidRawQuotationToken, isValidQuotationTokenHash |  |  |  |
| lib/rfq/offer-submission.ts | resolveSupplierInvitation, submitOfferForm |  | rfq_providers, rfq_items, cost_observations |  |
| lib/rfq/service.ts | rpc, createCanonicalRfq, submitCanonicalOffer, saveHumanAllocation, loadRfqWorkspace |  | rfqs, rfq_items, rfq_providers, rfq_allocations, quotes, quote_versions, quote_version_items, rfq_quote_reviews |  |
| lib/scanner/debug-store.ts | isScannerDebugActive |  |  |  |
| lib/scanner/offline-store.ts | saveOfflinePages, getOfflinePages, clearOfflinePages |  |  |  |
| lib/scanner/session-service.ts | createScanSession, getScanSessionByCredential, getScanSessionByToken, verifyAndGetSessionByPin, claimScanSession, updateScanSessionStatus, completeScanSession | createAdminClient | scan_sessions, scan_pin_attempts | scan_session_create_atomic, scan_pin_check_actor_lock, scan_pin_record_failed_attempt, scan_pin_reset_actor_attempts |
| lib/scanner/tokens.ts | generateScanToken, hashScanToken, generateScanPin, isSessionExpired |  |  |  |
| lib/tools/erp/post-inventory-movement.ts | createRodrigoMovementIdempotencyKey |  | productos |  |
| lib/workbook-interpretation/interpreter.ts | callWorkbookInterpreter, validateWorkbookInterpretation, interpretWorkbook |  |  |  |
| lib/workbook-interpretation/parser.ts | contiguousBlocks, parseParaguayanNumber, isRangeWithinSheet, parseWorkbook |  |  |  |
| lib/workspace/actions.ts | loadPrebidWorkspaceAction, saveWorkspaceBudgetItemAction, importTenderComputoAction, saveWorkspaceApuLineAction, deleteWorkspaceApuLineAction, adoptWorkspacePriceAction, createWorkspaceDiscoveryAction, savePrebidSettingsAction, savePrebidVersionAction, recordPrebidOutcomeAction, getWorkspaceBimUploadAction, registerWorkspaceBimAction, applyWorkspaceBimQuantityAction | requirePlan, createClient, createAdminClient | licitacion_ofertas, licitacion_oferta_versions, productos, providers, projects, budget_items, budget_item_materials, bim_elements | prebid_workspace, prebid_handoff_snapshot, prebid_import_computo, workspace_adopt_price, prebid_commit_version, prebid_record_outcome, workspace_register_bim, workspace_apply_bim_quantity |
| components/layout/branding-actions.ts | uploadLogo | requireProfile, createAdminClient | branding |  |
| worker/index.ts |  | createClient | invoice_jobs, invoice-files, attachments, invoices, invoice_items, authorized_order_items, invoice_item_matches | requeue_stale_invoice_jobs, claim_invoice_job |
| server/voice-ws-proxy.ts |  |  |  |  |

## Deployed RPC/helper inventory

- public.accept_quotation(p_token_hash text, p_acceptor_name text, p_acceptor_doc text, p_notes text, p_ip text, p_user_agent text): DEFINER; standalone EXECUTE anon=false, authenticated=false
- public.advance_sandbox_room(p_room_id uuid): DEFINER; standalone EXECUTE anon=false, authenticated=false
- public.append_sandbox_event(p_room_id uuid, p_type text, p_payload jsonb): DEFINER; standalone EXECUTE anon=false, authenticated=false
- public.approve_subcontractor_certificate_atomically(p_empresa_id uuid, p_certificate_id uuid, p_approved_pct numeric, p_approved_amount numeric, p_notes text, p_actor_id uuid): DEFINER; standalone EXECUTE anon=false, authenticated=true
- public.assert_mrp_actor(p_empresa_id uuid, p_actor_id uuid): DEFINER; standalone EXECUTE anon=false, authenticated=false
- public.bloquear_modificacion_snapshot(): INVOKER; standalone EXECUTE anon=true, authenticated=true
- public.bump_quotation_version_on_doc_update(): DEFINER; standalone EXECUTE anon=true, authenticated=true
- public.bump_quotation_version_on_item_change(): DEFINER; standalone EXECUTE anon=true, authenticated=true
- public.calcular_dv_ruc_py(p_ruc text): INVOKER; standalone EXECUTE anon=true, authenticated=true
- public.can_read_warehouse_evidence(p_object_name text): DEFINER; standalone EXECUTE anon=false, authenticated=true
- public.cancel_email_approval_for_draft(p_draft_id uuid, p_empresa_id uuid): DEFINER; standalone EXECUTE anon=false, authenticated=true
- public.cashflow_read_sources(p_from date, p_until date): DEFINER; standalone EXECUTE anon=false, authenticated=true
- public.cashflow_read_sources_base(p_from date, p_until date): DEFINER; standalone EXECUTE anon=false, authenticated=false
- public.categorizar_tamano_contrato(p_monto numeric): INVOKER; standalone EXECUTE anon=true, authenticated=true
- public.check_invoice_delete_integrity(): DEFINER; standalone EXECUTE anon=true, authenticated=true
- public.claim_email_send(p_empresa_id uuid, p_user_id uuid, p_draft_id uuid, p_connection_id uuid, p_approval_id uuid, p_approved_revision bigint, p_approved_content_hash text, p_delivery_fingerprint text, p_allow_delivery_unknown_retry boolean): DEFINER; standalone EXECUTE anon=false, authenticated=false
- public.claim_invoice_job(): DEFINER; standalone EXECUTE anon=true, authenticated=true
- public.commit_production_plan_atomic(p_empresa_id uuid, p_actor_id uuid, p_plan_id uuid, p_project_id uuid, p_start_date date, p_end_date date, p_status text, p_notes text, p_items jsonb, p_weather_snapshot_batch_id uuid, p_location_id uuid, p_reserve_items jsonb, p_needed_by date, p_idempotency_key text): DEFINER; standalone EXECUTE anon=false, authenticated=false
- public.commit_weekly_plan_validated(p_sources_hash text, p_args jsonb): DEFINER; standalone EXECUTE anon=false, authenticated=false
- public.complete_email_send_attempt(p_send_attempt_id uuid, p_empresa_id uuid, p_user_id uuid, p_provider_message_id text): DEFINER; standalone EXECUTE anon=false, authenticated=false
- public.convertir_licitacion_a_proyecto_atomico(p_empresa_id uuid, p_name text, p_code text, p_client text, p_comitente text, p_contract_number text, p_contract_amount numeric, p_budget_total numeric, p_plazo_dias integer, p_anticipo_pct numeric, p_retencion_pct numeric, p_start_date date, p_end_date date, p_tender_id text, p_bid_analysis_run_id uuid, p_created_by uuid, p_budget_items jsonb, p_nombre_deposito text): DEFINER; standalone EXECUTE anon=false, authenticated=false
- public.crear_cuenta_financiera_atomica(p_empresa_id uuid, p_nombre text, p_tipo text, p_banco text, p_numero_cuenta text, p_moneda currency_code, p_saldo_inicial numeric, p_created_by uuid): DEFINER; standalone EXECUTE anon=false, authenticated=true
- public.create_receipt_portal_link(p_empresa_id uuid, p_order_id uuid, p_location_id uuid, p_token_hash text, p_token_hint text, p_expires_at timestamp with time zone, p_created_by uuid): DEFINER; standalone EXECUTE anon=false, authenticated=false
- public.current_empresa_id(): DEFINER; standalone EXECUTE anon=true, authenticated=true
- public.current_profile_role(): DEFINER; standalone EXECUTE anon=true, authenticated=true
- public.direct_purchase_confirm(p_preview_id uuid, p_hash text, p_confirm boolean): DEFINER; standalone EXECUTE anon=false, authenticated=true
- public.direct_purchase_preview(p_header jsonb, p_items jsonb): DEFINER; standalone EXECUTE anon=false, authenticated=true
- public.ejecutar_orden_pago_atomica(p_empresa_id uuid, p_op_id uuid, p_cuenta_id uuid, p_created_by uuid): DEFINER; standalone EXECUTE anon=false, authenticated=true
- public.email_connect_gmail(p_provider_email text, p_scopes text[], p_refresh_token text): DEFINER; standalone EXECUTE anon=false, authenticated=false
- public.email_connect_gmail(p_empresa_id uuid, p_user_id uuid, p_provider_email text, p_scopes text[], p_refresh_token text): DEFINER; standalone EXECUTE anon=false, authenticated=false
- public.email_delete_oauth_secret(p_secret_id uuid): DEFINER; standalone EXECUTE anon=false, authenticated=false
- public.email_delete_oauth_secret(p_secret_id uuid, p_empresa_id uuid, p_user_id uuid): DEFINER; standalone EXECUTE anon=false, authenticated=false
- public.email_read_oauth_secret(p_connection_id uuid): DEFINER; standalone EXECUTE anon=false, authenticated=false
- public.email_read_oauth_secret(p_connection_id uuid, p_empresa_id uuid, p_user_id uuid): DEFINER; standalone EXECUTE anon=false, authenticated=false
- public.email_read_oauth_secret_for_revoke(p_connection_id uuid, p_empresa_id uuid, p_user_id uuid): DEFINER; standalone EXECUTE anon=false, authenticated=false
- public.email_read_oauth_secret_for_send(p_send_attempt_id uuid, p_connection_id uuid, p_empresa_id uuid, p_user_id uuid): DEFINER; standalone EXECUTE anon=false, authenticated=false
- public.enforce_confirmed_canonical_oc_receipt_movement(): DEFINER; standalone EXECUTE anon=false, authenticated=false
- public.enforce_inventory_company_pro_plan(): DEFINER; standalone EXECUTE anon=false, authenticated=false
- public.enforce_manual_inventory_movement_contract(): INVOKER; standalone EXECUTE anon=false, authenticated=false
- public.enforce_oc_receipt_line_immutability(): DEFINER; standalone EXECUTE anon=false, authenticated=false
- public.enforce_warehouse_submission_canonical_confirmation(): DEFINER; standalone EXECUTE anon=false, authenticated=false
- public.enforce_warehouse_submission_movement_source(): DEFINER; standalone EXECUTE anon=false, authenticated=false
- public.evaluar_estado_documento_boveda(p_fecha_vencimiento date, p_es_vencible boolean, p_dias_alerta integer): INVOKER; standalone EXECUTE anon=true, authenticated=true
- public.execution_confirm_bim_group(p_project_id uuid, p_group_id uuid, p_budget_id uuid, p_update_quantity boolean, p_expected_version timestamp with time zone): DEFINER; standalone EXECUTE anon=false, authenticated=true
- public.execution_create_bim_partidas(p_project_id uuid, p_groups jsonb): DEFINER; standalone EXECUTE anon=false, authenticated=true
- public.execution_save_forecast(p_project_id uuid, p_run jsonb, p_items jsonb): DEFINER; standalone EXECUTE anon=false, authenticated=true
- public.extraer_dv_ruc(p_ruc text): INVOKER; standalone EXECUTE anon=true, authenticated=true
- public.fail_email_send_attempt(p_send_attempt_id uuid, p_empresa_id uuid, p_user_id uuid, p_error_code text, p_failure_reason text): DEFINER; standalone EXECUTE anon=false, authenticated=false
- public.fn_mov_tesoreria_saldo(): DEFINER; standalone EXECUTE anon=false, authenticated=false
- public.force_close_sandbox_room(p_room_id uuid): DEFINER; standalone EXECUTE anon=false, authenticated=false
- public.get_competitor_contextual_fingerprint(p_supplier_id uuid, p_comitente text, p_categoria text, p_monto numeric): INVOKER; standalone EXECUTE anon=true, authenticated=true
- public.guard_accepted_quotation_immutable(): DEFINER; standalone EXECUTE anon=true, authenticated=true
- public.guard_accepted_quotation_items(): DEFINER; standalone EXECUTE anon=true, authenticated=true
- public.guard_agent_approval_immutable_payload(): INVOKER; standalone EXECUTE anon=true, authenticated=true
- public.guard_certificate_workbook_write(): DEFINER; standalone EXECUTE anon=false, authenticated=false
- public.guard_email_approval_binding(): DEFINER; standalone EXECUTE anon=false, authenticated=false
- public.guard_email_attachment_send_barrier(): DEFINER; standalone EXECUTE anon=false, authenticated=false
- public.guard_email_draft_send_barrier(): DEFINER; standalone EXECUTE anon=false, authenticated=false
- public.guard_project_certificate_create(): DEFINER; standalone EXECUTE anon=true, authenticated=true
- public.guard_project_certificate_header_immutability(): DEFINER; standalone EXECUTE anon=false, authenticated=false
- public.guard_project_certificate_line_write(): DEFINER; standalone EXECUTE anon=false, authenticated=false
- public.guard_project_certificate_status_transition(): DEFINER; standalone EXECUTE anon=false, authenticated=false
- public.guard_sales_provenance(): INVOKER; standalone EXECUTE anon=false, authenticated=false
- public.guard_subcontractor_certificate_project_scope(): DEFINER; standalone EXECUTE anon=false, authenticated=false
- public.guard_subcontractor_contract_project_scope(): DEFINER; standalone EXECUTE anon=false, authenticated=false
- public.guard_workbook_import_session_write(): DEFINER; standalone EXECUTE anon=false, authenticated=false
- public.import_project_certificate_atomically(p_project_id uuid, p_expected_number integer, p_period_start date, p_period_end date, p_import_fingerprint text, p_items jsonb): INVOKER; standalone EXECUTE anon=false, authenticated=true
- public.ingestar_proceso_ocds_global(p_cr jsonb, p_fuente text): DEFINER; standalone EXECUTE anon=false, authenticated=false
- public.inventory_add_manual_warehouse_submission_line(p_empresa_id uuid, p_submission_id uuid): DEFINER; standalone EXECUTE anon=false, authenticated=true
- public.inventory_apply_warehouse_upload_result(p_empresa_id uuid, p_submission_id uuid, p_resolved_sha256 text[], p_failed jsonb): DEFINER; standalone EXECUTE anon=false, authenticated=false
- public.inventory_confirm_receipt(p_empresa_id uuid, p_receipt_id uuid, p_delivery_location_id uuid, p_idempotency_key text, p_confirmed_by uuid): DEFINER; standalone EXECUTE anon=false, authenticated=true
- public.inventory_confirm_warehouse_submission(p_empresa_id uuid, p_submission_id uuid, p_confirmed_by uuid, p_idempotency_key text): DEFINER; standalone EXECUTE anon=false, authenticated=true
- public.inventory_create_receipt(p_empresa_id uuid, p_order_id uuid, p_fecha date, p_recibido_por text, p_delivery_location_id uuid, p_remision_number text, p_idempotency_key text, p_created_by uuid, p_notes text, p_items jsonb): DEFINER; standalone EXECUTE anon=false, authenticated=true
- public.inventory_portal_consumption(p_token_hash text, p_product uuid, p_budget uuid, p_quantity numeric, p_attempt uuid, p_metadata jsonb): DEFINER; standalone EXECUTE anon=false, authenticated=false
- public.inventory_portal_receipt(p_token_hash text, p_order uuid, p_date date, p_received_by text, p_remision text, p_attempt uuid, p_notes text, p_items jsonb): DEFINER; standalone EXECUTE anon=false, authenticated=false
- public.inventory_post_manual_movement(p_empresa_id uuid, p_producto_id uuid, p_quantity numeric, p_unit text, p_movement_type text, p_from_location_id uuid, p_to_location_id uuid, p_project_id uuid, p_idempotency_key text, p_cost_currency currency_code, p_unit_cost numeric, p_exchange_rate_to_company numeric, p_created_by uuid, p_metadata jsonb): DEFINER; standalone EXECUTE anon=false, authenticated=true
- public.inventory_post_movement(p_empresa_id uuid, p_producto_id uuid, p_quantity numeric, p_unit text, p_movement_type text, p_from_location_id uuid, p_to_location_id uuid, p_project_id uuid, p_budget_item_id uuid, p_source_type text, p_source_id uuid, p_source_line_id uuid, p_idempotency_key text, p_cost_currency currency_code, p_unit_cost numeric, p_exchange_rate_to_company numeric, p_created_by uuid, p_metadata jsonb): DEFINER; standalone EXECUTE anon=false, authenticated=false
- public.inventory_save_submission_lines_atomic(p_empresa_id uuid, p_submission_id uuid, p_evidence_id uuid, p_lines jsonb): DEFINER; standalone EXECUTE anon=false, authenticated=true
- public.inventory_set_receipt_item_product(p_empresa_id uuid, p_receipt_id uuid, p_item_id uuid, p_product_id uuid, p_updated_by uuid): DEFINER; standalone EXECUTE anon=false, authenticated=true
- public.is_internal_role(roles user_role[]): DEFINER; standalone EXECUTE anon=true, authenticated=true
- public.is_super_admin(): DEFINER; standalone EXECUTE anon=true, authenticated=true
- public.log_audit_event(p_action text, p_rfq_id uuid, p_rfq_provider_id uuid, p_invoice_id uuid, p_authorized_order_id uuid, p_detail jsonb, p_actor_type text, p_actor_label text): DEFINER; standalone EXECUTE anon=true, authenticated=true
- public.log_quotation_view(p_token_hash text, p_ip text, p_user_agent text): DEFINER; standalone EXECUTE anon=false, authenticated=false
- public.mark_email_send_attempt_dispatching(p_send_attempt_id uuid, p_empresa_id uuid, p_user_id uuid): DEFINER; standalone EXECUTE anon=false, authenticated=false
- public.mark_email_send_attempt_unknown(p_send_attempt_id uuid, p_empresa_id uuid, p_user_id uuid, p_error_code text, p_failure_reason text): DEFINER; standalone EXECUTE anon=false, authenticated=false
- public.mark_invoice_apto_para_pago(p_invoice_id uuid): DEFINER; standalone EXECUTE anon=true, authenticated=true
- public.mark_invoice_pagado(p_invoice_id uuid): DEFINER; standalone EXECUTE anon=true, authenticated=true
- public.next_cot_code(): DEFINER; standalone EXECUTE anon=true, authenticated=true
- public.next_doc_code(p_empresa_id uuid, p_doc_type text): DEFINER; standalone EXECUTE anon=false, authenticated=false
- public.next_op_code(): DEFINER; standalone EXECUTE anon=false, authenticated=true
- public.normalizar_ruc(p_ruc text): INVOKER; standalone EXECUTE anon=true, authenticated=true
- public.normalizar_texto(p_text text): INVOKER; standalone EXECUTE anon=true, authenticated=true
- public.planilla_confirmar_computo(p_planilla_id uuid): INVOKER; standalone EXECUTE anon=false, authenticated=true
- public.prebid_can_read(t text, r jsonb): DEFINER; standalone EXECUTE anon=false, authenticated=true
- public.prebid_commit_version(p_tender_id uuid, p_actor_id uuid, p_empresa_id uuid, p_present boolean, p_expected_hash text, p_offer_amount numeric): DEFINER; standalone EXECUTE anon=false, authenticated=false
- public.prebid_create_project(p_tender_id uuid, p_confirm boolean): DEFINER; standalone EXECUTE anon=false, authenticated=true
- public.prebid_handoff_snapshot(p_tender_id uuid): DEFINER; standalone EXECUTE anon=false, authenticated=true
- public.prebid_import_computo(p_tender_id uuid): DEFINER; standalone EXECUTE anon=false, authenticated=true
- public.prebid_record_outcome(p_tender_id uuid, p_estado text, p_awarded_amount numeric): DEFINER; standalone EXECUTE anon=false, authenticated=true
- public.prebid_save_version(p_tender_id uuid, p_present boolean, p_expected_hash text, p_offer_amount numeric): DEFINER; standalone EXECUTE anon=false, authenticated=false
- public.prebid_workspace(p_tender_id uuid): DEFINER; standalone EXECUTE anon=false, authenticated=true
- public.prevent_climate_event_relation_mutation(): INVOKER; standalone EXECUTE anon=true, authenticated=true
- public.prevent_climate_evidence_mutation(): INVOKER; standalone EXECUTE anon=true, authenticated=true
- public.prevent_closed_project_certificate_delete(): DEFINER; standalone EXECUTE anon=false, authenticated=false
- public.prevent_confirmation_with_unresolved_warehouse_evidence(): DEFINER; standalone EXECUTE anon=false, authenticated=false
- public.prevent_confirmed_warehouse_submission_evidence_mutation(): DEFINER; standalone EXECUTE anon=false, authenticated=false
- public.prevent_confirmed_warehouse_submission_line_mutation(): DEFINER; standalone EXECUTE anon=false, authenticated=false
- public.prevent_confirmed_warehouse_submission_mutation(): DEFINER; standalone EXECUTE anon=false, authenticated=false
- public.prevent_inventory_movement_mutation(): DEFINER; standalone EXECUTE anon=false, authenticated=false
- public.prevent_non_draft_oc_receipt_delete(): DEFINER; standalone EXECUTE anon=false, authenticated=false
- public.prevent_order_quantity_below_confirmed_receipts(): DEFINER; standalone EXECUTE anon=false, authenticated=false
- public.prevent_treasury_ledger_mutation(): INVOKER; standalone EXECUTE anon=false, authenticated=false
- public.prevent_unmapped_portal_receipt_confirmation(): DEFINER; standalone EXECUTE anon=false, authenticated=false
- public.recompute_invoice_status(p_invoice_id uuid): DEFINER; standalone EXECUTE anon=true, authenticated=true
- public.recompute_order_facturado(p_order_id uuid): DEFINER; standalone EXECUTE anon=true, authenticated=true
- public.recompute_order_item_quantity_invoiced(): DEFINER; standalone EXECUTE anon=true, authenticated=true
- public.recompute_sales_document(p_doc uuid): DEFINER; standalone EXECUTE anon=false, authenticated=false
- public.recover_stale_email_send_attempts(p_cutoff timestamp with time zone): DEFINER; standalone EXECUTE anon=false, authenticated=false
- public.registrar_cobro_atomico(p_empresa_id uuid, p_sales_document_id uuid, p_amount numeric, p_method text, p_receipt_date date, p_reference text, p_notes text, p_cuenta_id uuid, p_created_by uuid): DEFINER; standalone EXECUTE anon=false, authenticated=true
- public.registrar_movimiento_tesoreria(p_empresa_id uuid, p_cuenta_id uuid, p_monto numeric, p_tipo text, p_fecha date, p_motivo text, p_payment_order_id uuid, p_sales_receipt_id uuid, p_project_id uuid, p_created_by uuid, p_permitir_negativo boolean): DEFINER; standalone EXECUTE anon=false, authenticated=true
- public.registrar_stock_movimiento(p_empresa_id uuid, p_producto_id uuid, p_tipo text, p_cantidad numeric, p_referencia_tipo text, p_referencia_id uuid, p_notas text, p_created_by uuid, p_costo_unitario numeric): DEFINER; standalone EXECUTE anon=false, authenticated=false
- public.registrar_transferencia(p_empresa_id uuid, p_cuenta_origen_id uuid, p_cuenta_destino_id uuid, p_monto_origen numeric, p_monto_destino numeric, p_fecha date, p_motivo text, p_created_by uuid): DEFINER; standalone EXECUTE anon=false, authenticated=true
- public.reject_quotation(p_token_hash text, p_reason text, p_actor_name text, p_ip text, p_user_agent text): DEFINER; standalone EXECUTE anon=false, authenticated=false
- public.reject_quotation_acceptance_write(): DEFINER; standalone EXECUTE anon=true, authenticated=true
- public.reject_subcontractor_certificate_atomically(p_empresa_id uuid, p_certificate_id uuid, p_notes text, p_actor_id uuid): DEFINER; standalone EXECUTE anon=false, authenticated=true
- public.release_plan_reservations(p_empresa_id uuid, p_actor_id uuid, p_plan_id uuid): DEFINER; standalone EXECUTE anon=false, authenticated=false
- public.requeue_stale_invoice_jobs(timeout_minutes integer, max_attempts integer): DEFINER; standalone EXECUTE anon=true, authenticated=true
- public.require_fx_for_foreign_currency_inventory_adjustment(): INVOKER; standalone EXECUTE anon=false, authenticated=false
- public.reserve_plan_stock(p_empresa_id uuid, p_actor_id uuid, p_project_id uuid, p_plan_id uuid, p_location_id uuid, p_items jsonb, p_needed_by date, p_idempotency_key text, p_replace boolean): DEFINER; standalone EXECUTE anon=false, authenticated=false
- public.resolve_legacy_inventory_cost(p_empresa_id uuid, p_producto_id uuid, p_legacy_unit_cost numeric): DEFINER; standalone EXECUTE anon=false, authenticated=false
- public.resolve_work_order_policy(p_empresa_id uuid, p_client_id uuid, p_project_id uuid): DEFINER; standalone EXECUTE anon=false, authenticated=false
- public.resync_project_certificate_quantities_atomically(p_empresa_id uuid, p_certificate_id uuid, p_actor_id uuid, p_updates jsonb): DEFINER; standalone EXECUTE anon=false, authenticated=true
- public.revert_project_certificate_status_atomically(p_certificate_id uuid, p_expected_status text): DEFINER; standalone EXECUTE anon=false, authenticated=true
- public.revertir_cobro_atomico(p_empresa_id uuid, p_sales_receipt_id uuid, p_reversal_reason text, p_created_by uuid): DEFINER; standalone EXECUTE anon=false, authenticated=true
- public.rfq_authorize_allocation(p_allocation_id uuid, p_confirm boolean): DEFINER; standalone EXECUTE anon=false, authenticated=true
- public.rfq_close_discovery(p_rfq_id uuid, p_confirm boolean): DEFINER; standalone EXECUTE anon=false, authenticated=true
- public.rfq_confirm_orders(p_allocation_id uuid, p_preview_hash text, p_confirm boolean): DEFINER; standalone EXECUTE anon=false, authenticated=true
- public.rfq_create(p_header jsonb, p_items jsonb, p_provider_ids uuid[]): DEFINER; standalone EXECUTE anon=false, authenticated=true
- public.rfq_invite(p_rfq_id uuid, p_provider_ids uuid[]): DEFINER; standalone EXECUTE anon=false, authenticated=true
- public.rfq_preview_orders(p_allocation_id uuid): DEFINER; standalone EXECUTE anon=false, authenticated=true
- public.rfq_renew_link(p_rfq_id uuid, p_rfq_provider_id uuid): DEFINER; standalone EXECUTE anon=false, authenticated=true
- public.rfq_review_quote(p_version_id uuid, p_extraction jsonb, p_comparison jsonb, p_resolution text): DEFINER; standalone EXECUTE anon=false, authenticated=true
- public.rfq_revoke_link(p_rfq_id uuid, p_rfq_provider_id uuid): DEFINER; standalone EXECUTE anon=false, authenticated=true
- public.rfq_save_allocation(p_rfq_id uuid, p_lines jsonb, p_justification text, p_expected_revision integer): DEFINER; standalone EXECUTE anon=false, authenticated=true
- public.rfq_submit_version(p_token text, p_offer jsonb, p_items jsonb, p_attachment_id uuid, p_actor_id uuid): DEFINER; standalone EXECUTE anon=false, authenticated=false
- public.save_production_recipe_atomic(p_empresa_id uuid, p_actor_id uuid, p_recipe_id uuid, p_project_id uuid, p_code text, p_name text, p_production_unit text, p_description text, p_contract_total_quantity numeric, p_source_type text, p_source_file_name text, p_components jsonb): DEFINER; standalone EXECUTE anon=false, authenticated=false
- public.save_weekly_plan_atomic(p_plan_id uuid, p_project_id uuid, p_start_date date, p_end_date date, p_status text, p_notes text, p_items jsonb, p_weather_snapshot_batch_id uuid): DEFINER; standalone EXECUTE anon=false, authenticated=true
- public.scan_pin_check_actor_lock(p_actor_key text): DEFINER; standalone EXECUTE anon=false, authenticated=false
- public.scan_pin_record_failed_attempt(p_actor_key text, p_max_attempts integer, p_lockout_seconds integer): DEFINER; standalone EXECUTE anon=false, authenticated=false
- public.scan_pin_reset_actor_attempts(p_actor_key text): DEFINER; standalone EXECUTE anon=false, authenticated=false
- public.scan_session_claim_atomic(p_session_id uuid, p_mobile_claim_token_hash text, p_device_info jsonb, p_user_id uuid): DEFINER; standalone EXECUTE anon=false, authenticated=false
- public.scan_session_complete_atomic(p_session_id uuid, p_storage_path text, p_file_name text, p_file_size bigint, p_page_count integer): DEFINER; standalone EXECUTE anon=false, authenticated=false
- public.scan_session_create_atomic(p_empresa_id uuid, p_user_id uuid, p_token_hash text, p_pin_code text, p_expires_at timestamp with time zone, p_context_type text, p_context_id text, p_target_field text, p_storage_bucket text): DEFINER; standalone EXECUTE anon=false, authenticated=false
- public.select_and_authorize_offer_atomically(p_empresa_id uuid, p_actor_id uuid, p_rfq_id uuid, p_rfq_provider_id uuid, p_quote_version_id uuid, p_selection_reason selection_reason, p_selection_reason_detail text): INVOKER; standalone EXECUTE anon=false, authenticated=true
- public.set_agent_approvals_empresa(): DEFINER; standalone EXECUTE anon=true, authenticated=true
- public.set_agent_runs_empresa(): DEFINER; standalone EXECUTE anon=true, authenticated=true
- public.set_agent_steps_empresa(): DEFINER; standalone EXECUTE anon=true, authenticated=true
- public.set_agent_tasks_empresa(): DEFINER; standalone EXECUTE anon=true, authenticated=true
- public.set_attachments_empresa(): DEFINER; standalone EXECUTE anon=true, authenticated=true
- public.set_audit_logs_empresa(): DEFINER; standalone EXECUTE anon=true, authenticated=true
- public.set_authorized_orders_empresa(): DEFINER; standalone EXECUTE anon=true, authenticated=true
- public.set_empresa_id_from_caller(): DEFINER; standalone EXECUTE anon=true, authenticated=true
- public.set_invoice_exceptions_empresa(): DEFINER; standalone EXECUTE anon=true, authenticated=true
- public.set_invoice_order_matches_empresa(): DEFINER; standalone EXECUTE anon=true, authenticated=true
- public.set_order_code(): DEFINER; standalone EXECUTE anon=true, authenticated=true
- public.set_payment_order_invoices_empresa(): DEFINER; standalone EXECUTE anon=true, authenticated=true
- public.set_payment_orders_empresa(): DEFINER; standalone EXECUTE anon=true, authenticated=true
- public.set_quotation_acceptance_empresa(): DEFINER; standalone EXECUTE anon=true, authenticated=true
- public.set_quotation_event_empresa(): DEFINER; standalone EXECUTE anon=true, authenticated=true
- public.set_quotation_token_empresa(): DEFINER; standalone EXECUTE anon=true, authenticated=true
- public.set_quote_versions_empresa(): DEFINER; standalone EXECUTE anon=true, authenticated=true
- public.set_quotes_empresa(): DEFINER; standalone EXECUTE anon=true, authenticated=true
- public.set_rfq_code(): DEFINER; standalone EXECUTE anon=true, authenticated=true
- public.set_rfq_providers_empresa(): DEFINER; standalone EXECUTE anon=true, authenticated=true
- public.set_routing_policy_empresa(): DEFINER; standalone EXECUTE anon=true, authenticated=true
- public.set_sales_child_empresa(): DEFINER; standalone EXECUTE anon=true, authenticated=true
- public.set_sales_document_code(): DEFINER; standalone EXECUTE anon=true, authenticated=true
- public.set_updated_at(): INVOKER; standalone EXECUTE anon=true, authenticated=true
- public.set_work_order_code(): DEFINER; standalone EXECUTE anon=true, authenticated=true
- public.set_work_order_empresa(): DEFINER; standalone EXECUTE anon=true, authenticated=true
- public.set_work_order_item_empresa(): DEFINER; standalone EXECUTE anon=true, authenticated=true
- public.submit_receipt_portal(p_token_hash text, p_fecha date, p_recibido_por text, p_remision_number text, p_notas text, p_items jsonb, p_evidence jsonb): DEFINER; standalone EXECUTE anon=false, authenticated=false
- public.submit_sandbox_bid(p_room_id uuid, p_participant_id uuid, p_price_pyg bigint, p_idempotency_key text, p_expected_policy_version integer): DEFINER; standalone EXECUTE anon=false, authenticated=false
- public.sync_inventory_legacy_projection(p_empresa_id uuid, p_producto_id uuid, p_location_ids uuid[]): DEFINER; standalone EXECUTE anon=false, authenticated=false
- public.sync_order_payment_status(p_order_id uuid): DEFINER; standalone EXECUTE anon=true, authenticated=true
- public.trg_recompute_on_invoice_total_change(): INVOKER; standalone EXECUTE anon=true, authenticated=true
- public.trg_recompute_on_match_change(): INVOKER; standalone EXECUTE anon=true, authenticated=true
- public.trg_recompute_sales_doc(): DEFINER; standalone EXECUTE anon=false, authenticated=false
- public.update_updated_at_column(): INVOKER; standalone EXECUTE anon=true, authenticated=true
- public.upsert_inventory_balance(p_empresa_id uuid, p_producto_id uuid, p_location_id uuid, p_cost_currency currency_code, p_quantity numeric, p_total_cost numeric, p_total_cost_company numeric, p_cost_status text, p_original_cost_currency text, p_original_unit_cost numeric, p_original_total_cost numeric, p_exchange_rate_to_company numeric, p_cost_source text): DEFINER; standalone EXECUTE anon=false, authenticated=false
- public.validate_climate_event_tenant(): INVOKER; standalone EXECUTE anon=true, authenticated=true
- public.validate_climate_evidence_tenant(): INVOKER; standalone EXECUTE anon=true, authenticated=true
- public.validate_inventory_balance_tenant(): DEFINER; standalone EXECUTE anon=false, authenticated=false
- public.validate_inventory_location_tenant(): DEFINER; standalone EXECUTE anon=false, authenticated=false
- public.validate_inventory_movement_cost_tenant(): DEFINER; standalone EXECUTE anon=false, authenticated=false
- public.validate_inventory_movement_tenant(): DEFINER; standalone EXECUTE anon=false, authenticated=false
- public.validate_oc_receipt_inventory_location(): DEFINER; standalone EXECUTE anon=false, authenticated=false
- public.validate_project_workday_tenant(): INVOKER; standalone EXECUTE anon=true, authenticated=true
- public.validate_warehouse_portal_link_tenant(): DEFINER; standalone EXECUTE anon=false, authenticated=false
- public.validate_warehouse_submission_evidence_tenant(): DEFINER; standalone EXECUTE anon=false, authenticated=false
- public.validate_warehouse_submission_line_tenant(): DEFINER; standalone EXECUTE anon=false, authenticated=false
- public.validate_warehouse_submission_tenant(): DEFINER; standalone EXECUTE anon=false, authenticated=false
- public.verificar_saldos_tesoreria(p_empresa_id uuid): INVOKER; standalone EXECUTE anon=false, authenticated=true
- public.weekly_plan_need_direct_preview(p_plan_id uuid, p_snapshot_id uuid, p_need_ids uuid[], p_header jsonb, p_items jsonb, p_seen jsonb): DEFINER; standalone EXECUTE anon=false, authenticated=true
- public.weekly_plan_need_rfq(p_plan_id uuid, p_snapshot_id uuid, p_need_ids uuid[], p_header jsonb, p_seen jsonb): DEFINER; standalone EXECUTE anon=false, authenticated=true
- public.weekly_plan_need_sources(p_plan_id uuid): DEFINER; standalone EXECUTE anon=false, authenticated=true
- public.weekly_plan_project_sources(p_project_id uuid): DEFINER; standalone EXECUTE anon=false, authenticated=true
- public.weekly_plan_refresh_needs(p_actor_id uuid, p_plan_id uuid, p_hash text, p_needed_by date, p_lines jsonb, p_seen jsonb): DEFINER; standalone EXECUTE anon=false, authenticated=false
- public.workspace_adopt_price(p_context jsonb, p_product_id uuid, p_source text, p_price numeric, p_quote_item_id uuid): DEFINER; standalone EXECUTE anon=false, authenticated=true
- public.workspace_apply_bim_quantity(p_context jsonb, p_budget_id uuid, p_elements uuid[], p_expected_version timestamp with time zone, p_quantity numeric): DEFINER; standalone EXECUTE anon=false, authenticated=true
- public.workspace_register_bim(p_context jsonb, p_file_name text, p_storage_path text, p_schema text, p_elements jsonb): DEFINER; standalone EXECUTE anon=false, authenticated=true
- private.execution_actor(p_project_id uuid, p_bim boolean): DEFINER; standalone EXECUTE anon=false, authenticated=false
- private.execution_bim_decision_guard(): DEFINER; standalone EXECUTE anon=false, authenticated=false
- private.execution_bim_guard(): DEFINER; standalone EXECUTE anon=false, authenticated=false
- private.execution_bim_match_guard(): DEFINER; standalone EXECUTE anon=false, authenticated=false
- private.execution_bim_membership_guard(): DEFINER; standalone EXECUTE anon=false, authenticated=false
- private.execution_bim_owner_immutable(): INVOKER; standalone EXECUTE anon=false, authenticated=false
- private.execution_bim_quantity_guard(): INVOKER; standalone EXECUTE anon=false, authenticated=false
- private.execution_climate_guard(): DEFINER; standalone EXECUTE anon=false, authenticated=false
- private.execution_climate_history_guard(): DEFINER; standalone EXECUTE anon=false, authenticated=false
- private.execution_forecast_provenance(): INVOKER; standalone EXECUTE anon=false, authenticated=false
- private.execution_observation_guard(): DEFINER; standalone EXECUTE anon=false, authenticated=false
- private.execution_schedule_guard(): DEFINER; standalone EXECUTE anon=false, authenticated=false
- private.execution_snapshot_immutable(): INVOKER; standalone EXECUTE anon=false, authenticated=false
- private.handoff_certificate_parameters_guard(): DEFINER; standalone EXECUTE anon=false, authenticated=false
- private.inventory_opening_guard(): DEFINER; standalone EXECUTE anon=false, authenticated=false
- private.inventory_opening_key(e uuid, p uuid, l uuid, c currency_code, m jsonb): INVOKER; standalone EXECUTE anon=false, authenticated=false
- private.inventory_post_manual_movement(p_empresa_id uuid, p_producto_id uuid, p_quantity numeric, p_unit text, p_movement_type text, p_from_location_id uuid, p_to_location_id uuid, p_project_id uuid, p_idempotency_key text, p_cost_currency currency_code, p_unit_cost numeric, p_exchange_rate_to_company numeric, p_created_by uuid, p_metadata jsonb): DEFINER; standalone EXECUTE anon=false, authenticated=false
- private.inventory_receipt_actor_guard(): DEFINER; standalone EXECUTE anon=false, authenticated=false
- private.inventory_receipt_context_guard(): DEFINER; standalone EXECUTE anon=false, authenticated=false
- private.prebid_actor_guard(): DEFINER; standalone EXECUTE anon=false, authenticated=false
- private.prebid_attachment_guard(): DEFINER; standalone EXECUTE anon=false, authenticated=false
- private.prebid_bim_file_guard(): DEFINER; standalone EXECUTE anon=false, authenticated=false
- private.prebid_facts(t uuid): DEFINER; standalone EXECUTE anon=false, authenticated=false
- private.prebid_offer_actor_guard(): DEFINER; standalone EXECUTE anon=false, authenticated=false
- private.prebid_offer_fields_guard(): DEFINER; standalone EXECUTE anon=false, authenticated=false
- private.prebid_offer_guard(): DEFINER; standalone EXECUTE anon=false, authenticated=false
- private.prebid_outcome_snapshot_guard(): DEFINER; standalone EXECUTE anon=false, authenticated=false
- private.prebid_price_guard(): DEFINER; standalone EXECUTE anon=false, authenticated=false
- private.prebid_related_guard(): DEFINER; standalone EXECUTE anon=false, authenticated=false
- private.prebid_tender_history_guard(): DEFINER; standalone EXECUTE anon=false, authenticated=false
- private.prebid_validate_charge(c jsonb): INVOKER; standalone EXECUTE anon=false, authenticated=false
- private.prebid_validate_settings(s jsonb): INVOKER; standalone EXECUTE anon=false, authenticated=false
- private.prebid_version_guard(): DEFINER; standalone EXECUTE anon=false, authenticated=false
- private.prebid_write_guard(): DEFINER; standalone EXECUTE anon=false, authenticated=false
- private.project_baseline_guard(): DEFINER; standalone EXECUTE anon=false, authenticated=false
- private.project_handoff_origin_guard(): DEFINER; standalone EXECUTE anon=false, authenticated=false
- private.rfq_actor(): DEFINER; standalone EXECUTE anon=false, authenticated=false
- private.rfq_audit(e uuid, r uuid, a uuid, event text, detail jsonb): DEFINER; standalone EXECUTE anon=false, authenticated=false
- private.rfq_child_guard(): DEFINER; standalone EXECUTE anon=false, authenticated=false
- private.rfq_closure_guard(): DEFINER; standalone EXECUTE anon=false, authenticated=false
- private.rfq_document_guard(): DEFINER; standalone EXECUTE anon=false, authenticated=false
- private.rfq_header_guard(): DEFINER; standalone EXECUTE anon=false, authenticated=false
- private.rfq_order_guard(): DEFINER; standalone EXECUTE anon=false, authenticated=false
- private.rfq_order_line_insert_guard(): DEFINER; standalone EXECUTE anon=false, authenticated=false
- private.rfq_order_line_snapshot_guard(): DEFINER; standalone EXECUTE anon=false, authenticated=false
- private.rfq_order_snapshot_guard(): DEFINER; standalone EXECUTE anon=false, authenticated=false
- private.rfq_quote_guard(): DEFINER; standalone EXECUTE anon=false, authenticated=false
- private.rfq_quote_parent_guard(): DEFINER; standalone EXECUTE anon=false, authenticated=false
- private.rfq_resolve_allocation(r rfqs, lines jsonb): DEFINER; standalone EXECUTE anon=false, authenticated=false
- private.weekly_executed_quantity(pid uuid, bid uuid): DEFINER; standalone EXECUTE anon=false, authenticated=false
- private.weekly_mrp_actor(pid uuid): DEFINER; standalone EXECUTE anon=false, authenticated=false
- private.weekly_mrp_lock(e uuid): INVOKER; standalone EXECUTE anon=false, authenticated=false
- private.weekly_mrp_source_lock(): DEFINER; standalone EXECUTE anon=false, authenticated=false
- private.weekly_need_check(plan_uuid uuid, snapshot_uuid uuid, need_ids uuid[]): DEFINER; standalone EXECUTE anon=false, authenticated=false
- private.weekly_need_history_guard(): INVOKER; standalone EXECUTE anon=false, authenticated=false
- private.weekly_need_order_guard(): DEFINER; standalone EXECUTE anon=false, authenticated=false
- private.weekly_plan_need_sources(plan_uuid uuid): DEFINER; standalone EXECUTE anon=false, authenticated=false
- private.weekly_plan_project_sources(project_uuid uuid): DEFINER; standalone EXECUTE anon=false, authenticated=false
- private.weekly_recipe_unit_guard(): DEFINER; standalone EXECUTE anon=false, authenticated=false
- private.workspace_actor(c jsonb): DEFINER; standalone EXECUTE anon=false, authenticated=false
- private.workspace_owner(t text, r jsonb): DEFINER; standalone EXECUTE anon=false, authenticated=false
- private.workspace_unit(raw text): INVOKER; standalone EXECUTE anon=false, authenticated=false

## Existing migrations

- supabase/migrations/20261002231537_production_schema_baseline.sql
- supabase/migrations/20261003000341_rfq_2_human_procurement.sql
- supabase/migrations/20261003004948_rfq_2_completion_and_integrity.sql
- supabase/migrations/20261003010730_rfq_2_provenance_boundary_guards.sql
- supabase/migrations/20261003011539_rfq_2_document_storage.sql
- supabase/migrations/20261003012030_rfq_2_tenant_code_uniqueness.sql
- supabase/migrations/20261003012927_rfq_2_direct_purchase_notes.sql
- supabase/migrations/20261003025110_rfq_2_sha256_order_preview.sql
- supabase/migrations/20261003030227_rfq_2_magic_link_rotation_race.sql
- supabase/migrations/20261003045035_prebid_owner_context.sql
- supabase/migrations/20261003045338_prebid_offer_lifecycle.sql
- supabase/migrations/20261003045339_prebid_shared_rfq_and_computo.sql
- supabase/migrations/20261003051352_prebid_tenant_and_history_hardening.sql
- supabase/migrations/20261003052047_prebid_bim_storage.sql
- supabase/migrations/20261003052234_prebid_boundary_completion.sql
- supabase/migrations/20261003052903_prebid_rfq_document_storage.sql
- supabase/migrations/20261003053910_prebid_actor_boundaries.sql
- supabase/migrations/20261003055813_prebid_audit_actor_and_server_boundary.sql
- supabase/migrations/20261003055843_prebid_audit_cost_composition_v2.sql
- supabase/migrations/20261003060959_prebid_audit_v2_validation_alias.sql
- supabase/migrations/20261003133414_inventory_canonical_boundaries.sql
- supabase/migrations/20261003133854_inventory_opening_identity.sql
- supabase/migrations/20261003134723_inventory_confirmed_opening_guard.sql
- supabase/migrations/20261003135206_inventory_portal_receipt_atomic.sql
- supabase/migrations/20261003135743_inventory_receipt_product_context.sql
- supabase/migrations/20261003142900_tender_project_contractual_handoff.sql
- supabase/migrations/20261003143645_handoff_contract_parameters_guard.sql
- supabase/migrations/20261003150104_execution_climate_contract_restore.sql
- supabase/migrations/20261003150147_execution_snapshot_and_bim_boundaries.sql
- supabase/migrations/20261003150909_execution_schedule_and_decision_guards.sql
- supabase/migrations/20261003151619_execution_bim_live_permissions.sql
- supabase/migrations/20261003151935_execution_observation_provenance.sql
- supabase/migrations/20261003152452_execution_bim_computo_atomic.sql
- supabase/migrations/20261003153235_execution_forecast_input_provenance.sql
- supabase/migrations/20261003153432_execution_climate_history_guard.sql
- supabase/migrations/20261003153954_execution_ifc_revision_identity.sql
- supabase/migrations/20261003172735_weekly_plan_need_provenance.sql
- supabase/migrations/20261003173918_weekly_plan_atomic_boundaries.sql
- supabase/migrations/20261003175511_weekly_need_boundary_hardening.sql
- supabase/migrations/20261003185132_weekly_need_direct_retry_contract.sql
- supabase/migrations/20261003185848_weekly_need_residual_and_read_permissions.sql
- supabase/migrations/20261003191155_weekly_plan_commit_source_gate.sql
- supabase/migrations/20261003193500_weekly_plan_retry_target_order.sql
- supabase/migrations/20261003195245_weekly_need_audit_capping_and_rfq_residual.sql
- supabase/migrations/20261003211113_cashflow_read_sources.sql
- supabase/migrations/20261003212845_cashflow_sales_actuals.sql
- supabase/migrations/20261004041015_sales_provenance_guard.sql
- supabase/migrations/20261004050753_goekua_document_identifier.sql

## New delta

Discovery checkpoint: no fixes during discovery. Final defensive delta follows.

## B11 defensive release delta

Only shared actor/tenant/worker/audit/financial authority, scanner activity/source boundaries, exact cron reachability, and a Next security patch were changed. No business module rebuilt, no TSX redesign, no new ERP feature.

New migrations (Preview only):
- 20261004200423_b11_authority_boundaries.sql
- 20261004204346_b11_invoice_source_tenant.sql
- 20261004210311_b11_invoice_reconciliation_lock.sql

New tests:
- lib/__tests__/b11-authority-db.spec.ts: all three actual migrations execute in isolated PostgreSQL (PGlite); 32 tests cover expected permissions/denials and authorized canonical OP/source behavior.
- lib/__tests__/b11-server-authority.spec.ts: 18 tests for inactive/module/plan/admin/scanner entry points and exact proxy -> cron handler authority, mocked runners only.
- Existing scanner tests preserve authorized activity fixtures and assert supplier denial before privileged Storage.

Reproducible live Preview check: scripts/batch11-verify-preview.sql (READ ONLY transaction, no identity impersonation). Ledgers Preview 51 / Production 48. Prior rollback company fixtures remaining: 0. No Production mutation, real fiscal/provider call, seed, stock reconciliation or merge.

Dependency delta: next 16.3.1 -> 16.3.8; its own @next/env/SWC and Sharp 0.35.3 -> 0.35.5/native packages. React and unrelated package versions unchanged. Final report records exact Advisor/dependency debt and verification limits.

Final concurrency delta: 20261004210311_b11_invoice_reconciliation_lock.sql locks the invoice/order resource before the actor/tenant check and reconciliation. The calculations are unchanged; approved invoice cannot be reverted by a stale reconciliation read. Local PostgreSQL row-lock-definition/reconciliation regressions: 5 PASS. Preview ledger final: 51.

## Final verification

READY FOR EXTERNAL AUDIT. 19 changed files; 3 new additive migrations; historical migrations unchanged.
Focused 89 PASS; isolated PostgreSQL 32 PASS; cross-module 528 PASS; full Vitest 1700 PASS / 16 SKIP; typecheck PASS; Next 16.3.8 Webpack build PASS; diff check PASS. Live Preview read-only catalog PASS. Authenticated live RLS/E2E/visual NOT VERIFIED (P3).
P0/P1 identified findings fixed; documented P2/P3 retained. Advisor 162 (2 ERROR/160 WARN) -> 149 (2 ERROR/147 WARN), 0 new findings. Runtime audit 0 critical after bounded security patch; 3 legacy package entries remain.
PR publication occurs after this documentation commit. Base/branch above; final HEAD is available in git/PR. No merge or Production deployment permitted by this batch.

## External audit correction delta (supersedes original final counts)

Prior audited HEAD: f8e542020287254720648c929332a844ad97410f. PR #32, same batch/11-final-hardening branch.

New migration: supabase/migrations/20261004213348_b11_settled_financial_relationships.sql (one additive migration; prior applied migrations unchanged).

Changed authority: BEFORE INSERT/UPDATE/DELETE invoker guards on invoice_order_matches and payment_order_invoices, plus settled-invoice BEFORE DELETE cascade protection. No RLS/grant/calculation redesign. Exact OLD/NEW parents locked in canonical invoice -> OC / OP -> invoice order; settled relationships have no service exemption. Normal unpaid reconciliation and EMITIDA membership remain intact.

Application: app/(internal)/invoices/[id]/actions.ts checks scoped DELETE errors/row results before audit/revalidation. app/(internal)/invoices/[id]/unmatch-button.tsx displays the canonical business error; invoice and OC detail pages hide unlink for frozen states. No redesign.

Tests: lib/__tests__/b11-authority-db.spec.ts adds 25 expected-denial/authorized workflow cases executing actual migrations/baseline PostgreSQL functions and RLS. lib/__tests__/b11-unmatch-action.spec.ts adds 4 action regressions. All synthetic DB test mutations are local rollback transactions; live Preview verification is read-only catalog only.

Final: focused 61 PASS; DB 57 PASS; cross-module 506 PASS/39 files; full Vitest 1729 PASS/16 SKIP; typecheck, Webpack build and diff check PASS. Preview read-only catalog PASS; ledger 52, Production ledger 48. Advisor remains 149 (2 ERROR/147 WARN), no correction increase. Actual multi-connection live race/authenticated RLS/E2E/visual NOT VERIFIED. Hosted Preview previously canceled by ignored-build-step; no READY claimed.

P1 financial link immutability corrected; identified P0/P1 open: 0/0. Inherited P2/P3 debt retained. READY FOR EXTERNAL RE-AUDIT. No Production/data/71x2/main mutation, real fiscal issuance, merge or new roadmap batch.
