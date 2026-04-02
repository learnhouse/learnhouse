/**
 * SCORM Runtime API Bridge
 * Implements JavaScript API for SCORM 1.2 and SCORM 2004
 * Handles communication between SCORM content and the LearnHouse backend
 */

// SCORM 1.2 Error Codes
const SCORM_12_ERRORS = {
  NO_ERROR: '0',
  GENERAL_EXCEPTION: '101',
  INVALID_ARGUMENT: '201',
  ELEMENT_CANNOT_HAVE_CHILDREN: '202',
  ELEMENT_NOT_AN_ARRAY: '203',
  NOT_INITIALIZED: '301',
  NOT_IMPLEMENTED: '401',
  INVALID_SET_VALUE: '402',
  ELEMENT_IS_READ_ONLY: '403',
  ELEMENT_IS_WRITE_ONLY: '404',
  INCORRECT_DATA_TYPE: '405',
}

// SCORM 2004 Error Codes
const SCORM_2004_ERRORS = {
  NO_ERROR: '0',
  GENERAL_EXCEPTION: '101',
  GENERAL_INITIALIZATION_FAILURE: '102',
  ALREADY_INITIALIZED: '103',
  CONTENT_INSTANCE_TERMINATED: '104',
  GENERAL_TERMINATION_FAILURE: '111',
  TERMINATION_BEFORE_INITIALIZATION: '112',
  TERMINATION_AFTER_TERMINATION: '113',
  RETRIEVE_DATA_BEFORE_INITIALIZATION: '122',
  RETRIEVE_DATA_AFTER_TERMINATION: '123',
  STORE_DATA_BEFORE_INITIALIZATION: '132',
  STORE_DATA_AFTER_TERMINATION: '133',
  COMMIT_BEFORE_INITIALIZATION: '142',
  COMMIT_AFTER_TERMINATION: '143',
  GENERAL_ARGUMENT_ERROR: '201',
  GENERAL_GET_FAILURE: '301',
  GENERAL_SET_FAILURE: '351',
  GENERAL_COMMIT_FAILURE: '391',
  UNDEFINED_DATA_MODEL_ELEMENT: '401',
  UNIMPLEMENTED_DATA_MODEL_ELEMENT: '402',
  DATA_MODEL_ELEMENT_VALUE_NOT_INITIALIZED: '403',
  DATA_MODEL_ELEMENT_IS_READ_ONLY: '404',
  DATA_MODEL_ELEMENT_IS_WRITE_ONLY: '405',
  DATA_MODEL_ELEMENT_TYPE_MISMATCH: '406',
  DATA_MODEL_ELEMENT_VALUE_OUT_OF_RANGE: '407',
  DATA_MODEL_DEPENDENCY_NOT_ESTABLISHED: '408',
}

export class ScormRuntimeAPI {
  private activityUuid: string
  private scormVersion: string
  private accessToken: string
  private apiUrl: string
  private isInitialized: boolean = false
  private isTerminated: boolean = false
  private cmiData: Record<string, string> = {}
  private lastError: string = '0'
  private commitInterval: number | null = null
  private pendingChanges: boolean = false

  constructor(
    activityUuid: string,
    scormVersion: string,
    accessToken: string,
    apiUrl: string
  ) {
    this.activityUuid = activityUuid
    this.scormVersion = scormVersion
    this.accessToken = accessToken
    this.apiUrl = apiUrl
  }

  /**
   * Initialize the SCORM session with the backend
   */
  async initialize(): Promise<boolean> {
    try {
      const url = `${this.apiUrl}scorm/${this.activityUuid}/runtime/initialize`

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.accessToken}`,
        },
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.error('[ScormRuntimeAPI] Initialize error response:', errorText)
        throw new Error(`Failed to initialize SCORM session: ${response.status} ${errorText}`)
      }

      const data = await response.json()
      
      this.cmiData = data.cmi_data || {}
      this.isInitialized = true
      this.lastError = '0'

      // Set up auto-commit interval (every 60 seconds)
      this.commitInterval = window.setInterval(() => {
        if (this.pendingChanges && this.isInitialized && !this.isTerminated) {
          this.commitToBackend()
        }
      }, 60000)

      // Set up beforeunload handler
      window.addEventListener('beforeunload', this.handleBeforeUnload)

      return true
    } catch (error) {
      console.error('SCORM initialization error:', error)
      this.lastError = this.scormVersion === 'SCORM_2004'
        ? SCORM_2004_ERRORS.GENERAL_INITIALIZATION_FAILURE
        : SCORM_12_ERRORS.GENERAL_EXCEPTION
      return false
    }
  }

  /**
   * Terminate the SCORM session
   */
  async terminate(): Promise<boolean> {
    if (!this.isInitialized) {
      this.lastError = this.scormVersion === 'SCORM_2004'
        ? SCORM_2004_ERRORS.TERMINATION_BEFORE_INITIALIZATION
        : SCORM_12_ERRORS.NOT_INITIALIZED
      return false
    }

    if (this.isTerminated) {
      this.lastError = this.scormVersion === 'SCORM_2004'
        ? SCORM_2004_ERRORS.TERMINATION_AFTER_TERMINATION
        : SCORM_12_ERRORS.GENERAL_EXCEPTION
      return false
    }

    try {
      // Clear auto-commit interval
      if (this.commitInterval) {
        window.clearInterval(this.commitInterval)
        this.commitInterval = null
      }

      // Remove beforeunload handler
      window.removeEventListener('beforeunload', this.handleBeforeUnload)

      // Send final commit to backend
      const response = await fetch(
        `${this.apiUrl}scorm/${this.activityUuid}/runtime/terminate`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.accessToken}`,
          },
          body: JSON.stringify(this.cmiData),
        }
      )

      if (!response.ok) {
        throw new Error('Failed to terminate SCORM session')
      }

      this.isTerminated = true
      this.lastError = '0'
      return true
    } catch (error) {
      console.error('SCORM termination error:', error)
      this.lastError = this.scormVersion === 'SCORM_2004'
        ? SCORM_2004_ERRORS.GENERAL_TERMINATION_FAILURE
        : SCORM_12_ERRORS.GENERAL_EXCEPTION
      return false
    }
  }

  /**
   * Get a CMI data element value
   */
  getValue(element: string): string {
    if (!this.isInitialized) {
      this.lastError = this.scormVersion === 'SCORM_2004'
        ? SCORM_2004_ERRORS.RETRIEVE_DATA_BEFORE_INITIALIZATION
        : SCORM_12_ERRORS.NOT_INITIALIZED
      return ''
    }

    if (this.isTerminated) {
      this.lastError = this.scormVersion === 'SCORM_2004'
        ? SCORM_2004_ERRORS.RETRIEVE_DATA_AFTER_TERMINATION
        : SCORM_12_ERRORS.GENERAL_EXCEPTION
      return ''
    }

    this.lastError = '0'
    return this.cmiData[element] || ''
  }

  /**
   * Set a CMI data element value
   */
  setValue(element: string, value: string): boolean {
    if (!this.isInitialized) {
      this.lastError = this.scormVersion === 'SCORM_2004'
        ? SCORM_2004_ERRORS.STORE_DATA_BEFORE_INITIALIZATION
        : SCORM_12_ERRORS.NOT_INITIALIZED
      return false
    }

    if (this.isTerminated) {
      this.lastError = this.scormVersion === 'SCORM_2004'
        ? SCORM_2004_ERRORS.STORE_DATA_AFTER_TERMINATION
        : SCORM_12_ERRORS.GENERAL_EXCEPTION
      return false
    }

    // Check for read-only elements
    if (this.isReadOnlyElement(element)) {
      this.lastError = this.scormVersion === 'SCORM_2004'
        ? SCORM_2004_ERRORS.DATA_MODEL_ELEMENT_IS_READ_ONLY
        : SCORM_12_ERRORS.ELEMENT_IS_READ_ONLY
      return false
    }

    this.cmiData[element] = value
    this.pendingChanges = true
    this.lastError = '0'
    return true
  }

  /**
   * Commit data to the backend
   */
  async commit(): Promise<boolean> {
    if (!this.isInitialized) {
      this.lastError = this.scormVersion === 'SCORM_2004'
        ? SCORM_2004_ERRORS.COMMIT_BEFORE_INITIALIZATION
        : SCORM_12_ERRORS.NOT_INITIALIZED
      return false
    }

    if (this.isTerminated) {
      this.lastError = this.scormVersion === 'SCORM_2004'
        ? SCORM_2004_ERRORS.COMMIT_AFTER_TERMINATION
        : SCORM_12_ERRORS.GENERAL_EXCEPTION
      return false
    }

    return this.commitToBackend()
  }

  /**
   * Internal method to commit to backend
   */
  private async commitToBackend(): Promise<boolean> {
    try {
      const response = await fetch(
        `${this.apiUrl}scorm/${this.activityUuid}/runtime/commit`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.accessToken}`,
          },
          body: JSON.stringify(this.cmiData),
        }
      )

      if (!response.ok) {
        throw new Error('Failed to commit SCORM data')
      }

      this.pendingChanges = false
      this.lastError = '0'
      return true
    } catch (error) {
      console.error('SCORM commit error:', error)
      this.lastError = this.scormVersion === 'SCORM_2004'
        ? SCORM_2004_ERRORS.GENERAL_COMMIT_FAILURE
        : SCORM_12_ERRORS.GENERAL_EXCEPTION
      return false
    }
  }

  /**
   * Handle beforeunload event
   */
  private handleBeforeUnload = (event: BeforeUnloadEvent) => {
    if (this.pendingChanges && this.isInitialized && !this.isTerminated) {
      // Attempt synchronous commit using sendBeacon
      const data = JSON.stringify(this.cmiData)
      navigator.sendBeacon(
        `${this.apiUrl}scorm/${this.activityUuid}/runtime/commit`,
        new Blob([data], { type: 'application/json' })
      )
    }
  }

  /**
   * Check if element is read-only
   */
  private isReadOnlyElement(element: string): boolean {
    const readOnlyElements12 = [
      'cmi.core._children',
      'cmi.core.student_id',
      'cmi.core.student_name',
      'cmi.core.credit',
      'cmi.core.entry',
      'cmi.core.total_time',
      'cmi.core.lesson_mode',
      'cmi.launch_data',
      'cmi.comments_from_lms',
    ]

    const readOnlyElements2004 = [
      'cmi._version',
      'cmi.completion_threshold',
      'cmi.credit',
      'cmi.entry',
      'cmi.launch_data',
      'cmi.learner_id',
      'cmi.learner_name',
      'cmi.max_time_allowed',
      'cmi.mode',
      'cmi.scaled_passing_score',
      'cmi.time_limit_action',
      'cmi.total_time',
    ]

    const readOnly = this.scormVersion === 'SCORM_2004'
      ? readOnlyElements2004
      : readOnlyElements12

    return readOnly.some((ro) => element.startsWith(ro))
  }

  /**
   * Get last error code
   */
  getLastError(): string {
    return this.lastError
  }

  /**
   * Get error string for error code
   */
  getErrorString(errorCode: string): string {
    const errorStrings12: Record<string, string> = {
      '0': 'No Error',
      '101': 'General Exception',
      '201': 'Invalid argument error',
      '202': 'Element cannot have children',
      '203': 'Element not an array - Cannot have count',
      '301': 'Not initialized',
      '401': 'Not implemented error',
      '402': 'Invalid set value, element is a keyword',
      '403': 'Element is read only',
      '404': 'Element is write only',
      '405': 'Incorrect Data Type',
    }

    const errorStrings2004: Record<string, string> = {
      '0': 'No Error',
      '101': 'General Exception',
      '102': 'General Initialization Failure',
      '103': 'Already Initialized',
      '104': 'Content Instance Terminated',
      '111': 'General Termination Failure',
      '112': 'Termination Before Initialization',
      '113': 'Termination After Termination',
      '122': 'Retrieve Data Before Initialization',
      '123': 'Retrieve Data After Termination',
      '132': 'Store Data Before Initialization',
      '133': 'Store Data After Termination',
      '142': 'Commit Before Initialization',
      '143': 'Commit After Termination',
      '201': 'General Argument Error',
      '301': 'General Get Failure',
      '351': 'General Set Failure',
      '391': 'General Commit Failure',
      '401': 'Undefined Data Model Element',
      '402': 'Unimplemented Data Model Element',
      '403': 'Data Model Element Value Not Initialized',
      '404': 'Data Model Element Is Read Only',
      '405': 'Data Model Element Is Write Only',
      '406': 'Data Model Element Type Mismatch',
      '407': 'Data Model Element Value Out Of Range',
      '408': 'Data Model Dependency Not Established',
    }

    const strings = this.scormVersion === 'SCORM_2004'
      ? errorStrings2004
      : errorStrings12

    return strings[errorCode] || 'Unknown Error'
  }

  /**
   * Get diagnostic information for error
   */
  getDiagnostic(errorCode: string): string {
    return this.getErrorString(errorCode)
  }

  /**
   * Get SCORM 1.2 API object for injection
   */
  getScorm12API() {
    return {
      LMSInitialize: (_: string) => {
        // Already initialized on the backend
        this.lastError = '0'
        return 'true'
      },
      LMSFinish: (_: string) => {
        this.terminate()
        return this.lastError === '0' ? 'true' : 'false'
      },
      LMSGetValue: (element: string) => {
        return this.getValue(element)
      },
      LMSSetValue: (element: string, value: string) => {
        return this.setValue(element, value) ? 'true' : 'false'
      },
      LMSCommit: (_: string) => {
        this.commit()
        return this.lastError === '0' ? 'true' : 'false'
      },
      LMSGetLastError: () => {
        return this.getLastError()
      },
      LMSGetErrorString: (errorCode: string) => {
        return this.getErrorString(errorCode)
      },
      LMSGetDiagnostic: (errorCode: string) => {
        return this.getDiagnostic(errorCode)
      },
    }
  }

  /**
   * Get SCORM 2004 API object for injection
   */
  getScorm2004API() {
    return {
      Initialize: (_: string) => {
        // Already initialized on the backend
        this.lastError = '0'
        return 'true'
      },
      Terminate: (_: string) => {
        this.terminate()
        return this.lastError === '0' ? 'true' : 'false'
      },
      GetValue: (element: string) => {
        return this.getValue(element)
      },
      SetValue: (element: string, value: string) => {
        return this.setValue(element, value) ? 'true' : 'false'
      },
      Commit: (_: string) => {
        this.commit()
        return this.lastError === '0' ? 'true' : 'false'
      },
      GetLastError: () => {
        return this.getLastError()
      },
      GetErrorString: (errorCode: string) => {
        return this.getErrorString(errorCode)
      },
      GetDiagnostic: (errorCode: string) => {
        return this.getDiagnostic(errorCode)
      },
    }
  }
}
