export interface MtrTestCase {
  /** Fully qualified name, e.g. "main.alias" */
  name: string;
  /** Short name without suite, e.g. "alias" */
  shortname: string;
  /** Absolute path to .test file in install directory */
  installPath: string;
  /** Absolute path to .result file in install directory */
  resultFile: string;
  /** Whether this test is skipped */
  skip: boolean;
  /** Skip reason */
  comment?: string;
  /** Suite name, e.g. "main" */
  suite: string;
}

export interface MtrTestCaseWithSource extends MtrTestCase {
  /** Absolute path to .test file in source tree */
  sourcePath: string;
  /** Absolute path to .result file in source tree */
  sourceResultPath?: string;
}
