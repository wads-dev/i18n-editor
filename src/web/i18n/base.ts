import type { Translation } from '@wads.dev/i18n-ts'

export interface EditorTranslation extends Translation {
  language: {
    label: string
    english: string
    portuguese: string
  }
  common: {
    root: string
    level: (index: number) => string
    keys: (count: number) => string
  }
  page: {
    eyebrow: string
    title: string
    intro: string
  }
  settings: {
    show: string
    hide: string
    title: string
    intro: string
    levelCount: string
    levelNames: string
    importsByLevel: string
    importsHelp: string
    pathTemplate: string
    valueReplacer: string
    fullReplacer: string
    translationsDirectory: string
    languageFileTemplate: string
    languageReplacer: string
    exportTitle: string
    exportIntro: string
    importAliases: string
    doubleQuotes: string
    semicolons: string
    shorthandProperties: string
    trailingCommas: string
    indentationCharacter: string
    space: string
    tab: string
    indentationSize: string
    printWidth: string
    maxObjectInlineItems: string
    maxArrayInlineItems: string
    objectLayout: string
    arrayLayout: string
    inlineWhenFits: string
    alwaysMultiline: string
    divergentFiles: string
    divergentFilesHelp: string
    detectDeletionCandidates: string
    ignoredExtensions: string
    allowDeletion: string
  }
  editor: {
    title: string
    emptySummary: string
    noBundle: string
    analyzeUsages: string
    updateUsages: string
    loadingUsages: string
    updatingUsages: string
    unreferencedOnly: string
    visualizationLevels: string
    search: string
    searchPlaceholder: string
    key: string
    usages: string
    base: string
    missing: string
    inconsistent: string
    notAnalyzed: string
    viewDetails: string
    exactReferences: (count: number) => string
    uncertainReferences: (count: number) => string
    usageSummary: (references: number, files: number, uncertain: boolean) => string
    potentiallyReachable: string
    noStaticReferences: string
    referencesFound: string
    dynamicMayReach: string
    noExactReferences: string
    noLocations: string
    doubleClickMove: string
    doubleClickEdit: string
    editTranslation: string
    removeKey: (key: string) => string
    bundleSummary: (keys: number, languages: number) => string
  }
  exportPreview: {
    title: string
    intro: string
    deleteDivergent: string
    checkDiffs: string
    checking: string
    checkAgain: string
    exportProject: string
    preparing: string
    exporting: string
    loadBundle: string
    noTranslations: string
    showDiff: string
    status: {
      create: string
      modify: string
      unchanged: string
      delete: string
    }
  }
  messages: {
    connecting: string
    retry: string
    configurationUpdated: string
    moveKeyPrompt: string
    keyMoved: (source: string, target: string) => string
    removeKeyConfirm: (key: string) => string
    keyRemoved: (key: string) => string
    translationUpdated: (language: string, key: string) => string
    jsonObjectExpected: (field: string) => string
    couldNotSaveSettings: (error: string) => string
    couldNotSaveLocalCopy: (error: string) => string
    comparingFiles: string
    recalculating: string
    writingFiles: string
    exportCancelled: string
    projectUpToDate: string
    exported: string
    generatingBundle: string
    generatedBundle: string
    restoredBundle: string
    loadedBundle: string
    newerBundle: string
    noUsageCache: string
    unverifiedUsageCache: string
    usageSummary: (used: number, uncertain: number, unreferenced: number, files: number) => string
    couldNotAnalyzeUsages: (error: string) => string
    plannedChanges: (count: number) => string
    projectMatchesPreview: string
    couldNotCheckDiffs: (error: string) => string
    autoDeleteWarning: (count: number) => string
    preservedDeletionWarning: (count: number) => string
    noFilesDeleted: string
    filesWillBeDeleted: (count: number) => string
    filesWillBePreserved: (count: number) => string
    exportConfirm: (writable: number, deletion: string) => string
    exportResult: (written: number, deleted: number, preserved: number) => string
    couldNotExport: (error: string) => string
    importAliasesUpdated: string
    doubleQuotesEnabled: string
    singleQuotesEnabled: string
    semicolonsEnabled: string
    semicolonsDisabled: string
    shorthandUpdated: string
    trailingCommasUpdated: string
    indentationUpdated: string
    printWidthUpdated: string
    inlineLimitsUpdated: string
    layoutsUpdated: string
    languageReplacerUpdated: string
    deletionDetectionEnabled: string
    deletionDetectionDisabled: string
    ignoredExtensionsUpdated: string
    autoDeleteEnabled: string
    autoDeleteDisabled: string
    missingCatalog: string
    couldNotLoadProject: (error: string) => string
  }
}
