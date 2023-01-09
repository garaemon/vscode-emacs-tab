'use strict';
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import * as json from 'comment-json';

// Rule configs
type IBracketRuleConfig = [string, string];

interface IEnterRuleConfig {
  beforeText?: string;
  afterText?: string;
}

interface IIndentationRuleConfig {
  unIndentedLinePattern?: string;
  increaseIndentPattern?: string;
  decreaseIndentPattern?: string;
  indentNextLinePattern?: string;
}

interface ILanguageConfiguration {
  indentationRules?: IIndentationRuleConfig;
  onEnterRules?: IEnterRuleConfig[];
  brackets?: IBracketRuleConfig[];
}

class BracketRule {
  public openBracket: string;
  public closeBracket: string;
  public openRegExp: RegExp | null;
  public closeRegExp: RegExp | null;

  public constructor(config: IBracketRuleConfig) {
    this.openBracket = config[0];
    this.closeBracket = config[1];
    this.openRegExp = this.createOpenBracketRegExp(this.openBracket);
    this.closeRegExp = this.createCloseBracketRegExp(this.closeBracket);
  }

  private createOpenBracketRegExp(openBracket: string): RegExp | null {
    let str = escapeRegExpCharacters(openBracket);
    if (!/\B/.test(str.charAt(0))) {
      str = '\\b' + str;
    }
    str += '\\s*$';
    return createRegExp(str);
  }

  private createCloseBracketRegExp(closeBracket: string): RegExp | null {
    let str = escapeRegExpCharacters(closeBracket);
    if (!/\B/.test(str.charAt(str.length - 1))) {
      str = str + '\\b';
    }
    str = '^\\s*' + str;
    return createRegExp(str);
  }
}

class IndentationRule {
  private unIndentedLinePattern: RegExp | null = null;
  private increaseIndentPattern: RegExp | null = null;
  private decreaseIndentPattern: RegExp | null = null;
  private indentNextLinePattern: RegExp | null = null;

  public constructor(config: IIndentationRuleConfig) {
    if (!config) {
      return;
    }
    if (config.unIndentedLinePattern) {
      this.unIndentedLinePattern =
        this.createRegExp(config.unIndentedLinePattern);
    }
    if (config.increaseIndentPattern) {
      this.increaseIndentPattern =
        this.createRegExp(config.increaseIndentPattern);
    }
    if (config.decreaseIndentPattern) {
      this.decreaseIndentPattern =
        this.createRegExp(config.decreaseIndentPattern);
    }
    if (config.indentNextLinePattern) {
      this.indentNextLinePattern =
        this.createRegExp(config.indentNextLinePattern);
    }
  }

  public testUnIndentedLinePattern(line: string): boolean {
    if (this.unIndentedLinePattern) {
      return this.unIndentedLinePattern.test(line);
    }
    else {
      return false;
    }
  }

  public testIncreaseIndentPattern(line: string): boolean {
    if (this.increaseIndentPattern) {
      return this.increaseIndentPattern.test(line);
    }
    else {
      return false;
    }
  }

  public testDecreaseIndentPattern(line: string): boolean {
    if (this.decreaseIndentPattern) {
      return this.decreaseIndentPattern.test(line);
    } else {
      return false;
    }
  }

  public testIndentNextLinePattern(line: string): boolean {
    if (this.indentNextLinePattern) {
      return this.indentNextLinePattern.test(line);
    } else {
      return false;
    }
  }

  public estimateIndentAction(validPreviousLine: string, currentLine: string):
    vscode.IndentAction | null {
    let nextIndentLevel: number = 0;
    let ruleMatched: boolean = false;
    if (this.testUnIndentedLinePattern(validPreviousLine)) {
      // do nothing
    } else if (this.testIncreaseIndentPattern(validPreviousLine)) {
      ruleMatched = true;
      ++nextIndentLevel;
    } else if (this.testIndentNextLinePattern(validPreviousLine)) {
      ruleMatched = true;
      ++nextIndentLevel;
    }

    if (this.testDecreaseIndentPattern(currentLine)) {
      ruleMatched = true;
      --nextIndentLevel;
    }
    if (ruleMatched) {
      if (nextIndentLevel === 0) {
        return vscode.IndentAction.None;
      } else if (nextIndentLevel > 0) {
        return vscode.IndentAction.Indent;
      } else if (nextIndentLevel < 0) {
        return vscode.IndentAction.Outdent;
      }
    }
    return null;
  }

  private createRegExp(s: string): RegExp | null {
    try {
      if (s && s.length > 0) {
        return new RegExp(s);
      } else {
        return null;
      }
    } catch (err) {
      return null;
    }
  }
}

const DEFAULT_BRACKETS = [
  ['(', ')'],
  ['{', '}'],
  ['[', ']'],
];

const ADDITIONAL_CONFIGURATION_FOR_LANGUAGE: {
  [id: string]: ILanguageConfiguration;
} = {
  python: {
    indentationRules: {
      increaseIndentPattern:
        '^\\s*(?:def|class|for|if|elif|else|while|try|with|finally|except|async).*?:\\s*$',
    },
  },
  html: {
    indentationRules: {
      increaseIndentPattern:
        '<(?!\\?|(?:area|base|br|col|frame|hr|html|img|input|link|meta|param)\\b|[^>]*\\/>)([-_\\.A-Za-z0-9]+)(?=\\s|>)\\b[^>]*>(?!.*<\\/\\1>)|<!--(?!.*-->)|\\{[^}"\']*$',
      decreaseIndentPattern: '^\\s*(<\\/(?!html)[-_\\.A-Za-z0-9]+\\b[^>]*>|-->|\\})',
    },
    // TODO: support onEnterRules
  },
};

let LANGUAGE_CONFIGURATION_CACHE: {
  [id: string]: ILanguageConfiguration
} = {};

function runReindentCurrentLineCommand(debug: boolean) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showInformationMessage('No editor');
    return;
  }
  const documentLanguageId: string = editor.document.languageId;

  // If documentLanguageId is not found in LANGUAGE_CONFIGURATION_CACHE, try to update
  // LANGUAGE_CONFIGURATION_CACHE first.
  if (!(documentLanguageId in LANGUAGE_CONFIGURATION_CACHE)) {
    const languageConfig = getLanguageConfiguration(documentLanguageId);
    if (languageConfig) {
      LANGUAGE_CONFIGURATION_CACHE[documentLanguageId] = languageConfig;
    }
    else {
      vscode.window.showInformationMessage(
        `no language config for ${documentLanguageId}`);
      return;
    }
  }

  const langConfig = LANGUAGE_CONFIGURATION_CACHE[documentLanguageId];
  const [previousValidLine, currentLine] = getPreviousAndCurrentLine(editor);
  const indent =
    estimateIndentAction(previousValidLine, currentLine, langConfig);
  if (debug) {
    vscode.window.showInformationMessage(convertIndentActionToString(indent));
  }
  else {
    reindentCurrentLine(indent, previousValidLine, currentLine, documentLanguageId);
  }
}

export function activate(context: vscode.ExtensionContext) {
  // Cleanup cache when the extension is activated.
  LANGUAGE_CONFIGURATION_CACHE = {};
  // CAVEAT: onDidOpenTextDocument is not called if a text buffer is newly created.
  // LANGUAGE_CONFIGURATION_CACHE should be updated when reindentCurrentLineCommand is called and
  // no suitable ILanguageConfiguration is found in LANGUAGE_CONFIGURATION_CACHE.
  vscode.workspace.onDidOpenTextDocument((d) => {
    const languageConfig = getLanguageConfiguration(d.languageId);
    if (languageConfig) {
      LANGUAGE_CONFIGURATION_CACHE[d.languageId] = languageConfig;
    }
  });

  // Register commands
  const reindentCurrentLineCommand =
    vscode.commands.registerCommand('emacs-tab.reindentCurrentLine', () => {
      runReindentCurrentLineCommand(false);
    });

  const debugEstimateIndentLevel = vscode.commands.registerCommand(
    'emacs-tab.debugEstimateIndentLevel', () => {
      runReindentCurrentLineCommand(true);
    });
  context.subscriptions.push(reindentCurrentLineCommand);
}

/**
 * Convert vscode.IndentAction to string.
 * @param {vscode.IndentAction} action
 * @return {string}
 */
function convertIndentActionToString(action: vscode.IndentAction): string {
  if (action === vscode.IndentAction.Indent) {
    return 'Indent';
  } else if (action === vscode.IndentAction.IndentOutdent) {
    return 'IndentOutdent';
  } else if (action === vscode.IndentAction.Outdent) {
    return 'Outdent';
  } else if (action === vscode.IndentAction.None) {
    return 'Keep';
  } else {
    return '';
  }
}

/**
 * @param {vscode.TextEditor} editor
 * @return {string[]} pair of the valid previous line and current line
 */
function getPreviousAndCurrentLine(editor: vscode.TextEditor): string[] {
  if (!editor.selection.isEmpty) {
    return ['', ''];
  }

  const currentPosition = editor.selection.active;
  const document = editor.document;
  const allLinesArray = document.getText().split('\n');
  const currentLine = allLinesArray[currentPosition.line];
  if (currentPosition.line === 0) {
    // first line, do nothing
    return ['', currentLine];
  }
  // Lookup valid previous line because the line consisted of white spaces gives
  // no effect on indentation.
  const validPreviousLine =
    getValidPreviousLine(allLinesArray, currentPosition.line);
  return [validPreviousLine, currentLine];
}

function mergeLanguageConfiguration(
  a: ILanguageConfiguration,
  b: ILanguageConfiguration): ILanguageConfiguration {
  const mergedConfiguration: ILanguageConfiguration = {
    indentationRules: undefined,
    brackets: [],
    onEnterRules: [],
  };
  if (a.indentationRules) {
    mergedConfiguration.indentationRules =
      Object.assign({}, a.indentationRules, b.indentationRules);
  } else {
    mergedConfiguration.indentationRules = b.indentationRules;
  }
  if (a.brackets) {
    mergedConfiguration.brackets = a.brackets.concat(b.brackets || []);
  } else {
    mergedConfiguration.brackets = b.brackets;
  }
  if (a.onEnterRules) {
    mergedConfiguration.onEnterRules =
      a.onEnterRules.concat(b.onEnterRules || []);
  } else {
    mergedConfiguration.onEnterRules = b.onEnterRules;
  }
  return mergedConfiguration;
}

/**
 * @param id {string} id of language
 * @return {Object} return language configuration
 */
function getLanguageConfiguration(id: string): ILanguageConfiguration | null {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return null;
  }
  const documentLanguageId: string = editor.document.languageId;
  let additionalConfiguration = {};
  if (documentLanguageId in ADDITIONAL_CONFIGURATION_FOR_LANGUAGE) {
    additionalConfiguration =
      ADDITIONAL_CONFIGURATION_FOR_LANGUAGE[documentLanguageId];
  }
  // walk through all the extensions
  for (const ext of vscode.extensions.all) {
    if (ext.packageJSON && ext.packageJSON.contributes &&
      ext.packageJSON.contributes.languages) {
      const packageLangData = ext.packageJSON.contributes.languages.find(
        (langData: any) => (langData.id === documentLanguageId));
      if (packageLangData) {
        const langConfigFilepath =
          path.join(ext.extensionPath, packageLangData.configuration);
        const configFileContent = fs.readFileSync(langConfigFilepath).toString();
        return mergeLanguageConfiguration(
          json.parse(configFileContent) as ILanguageConfiguration,
          additionalConfiguration);
      }
    }
  }

  // If no language config is found, find the configuration from resources directory because
  // embedded language extension is not available if remote vscode is used.
  const resourceDir = path.join(__dirname, '../resources');
  const languageDirs = fs.readdirSync(resourceDir);
  for (const languageDir of languageDirs) {
    const languageName = path.basename(languageDir);
    if (languageName == documentLanguageId) {
      // Hit
      const langConfigFilepath =
        path.join(resourceDir, languageDir, 'language-configuration.json');
      const configFileContent = fs.readFileSync(langConfigFilepath).toString();
      return mergeLanguageConfiguration(
        json.parse(configFileContent) as ILanguageConfiguration,
        additionalConfiguration);
    }
  }
  return null;
}

function estimateIndentAction(
  validPreviousLine: string, currentLine: string,
  languageConfiguration: ILanguageConfiguration): vscode.IndentAction {
  if (validPreviousLine == null) {
    return vscode.IndentAction.None;
  }
  const onEnterRulesArray = languageConfiguration.onEnterRules;
  const bracketsArray = languageConfiguration.brackets;
  const currentLineWithoutLeadingWhiteSpaces = currentLine.replace(/^\s*/, '');
  // 0 indentPattern
  if (languageConfiguration.indentationRules) {
    const indentationRule =
      new IndentationRule(languageConfiguration.indentationRules);
    const indentationRuleIndentAction =
      indentationRule.estimateIndentAction(validPreviousLine, currentLine);
    if (indentationRuleIndentAction != null) {
      return indentationRuleIndentAction;
    }
  }
  // 1 regexp Rule, not yet supported
  /*
  for (const rule of onEnterRulesArray) {
    if (rule.beforeText.test(validPreviousLine)) {
      if (rule.afterText) {
        if (rule.afterText.test(currentLineWithoutLeadingWhiteSpaces)) {
          return rule.action;
        }
      } else {
        return rule.action;
      }
    }
  }
  */

  // 2 special indent-outdent
  if (validPreviousLine.length > 0 &&
    currentLineWithoutLeadingWhiteSpaces.length > 0 && bracketsArray) {
    for (const bracketConfig of bracketsArray) {
      const bracket = new BracketRule(bracketConfig);
      if (bracket.openRegExp && bracket.closeRegExp && bracket.openRegExp.test(validPreviousLine) &&
        bracket.closeRegExp.test(currentLineWithoutLeadingWhiteSpaces)) {
        return vscode.IndentAction.IndentOutdent;
      }
    }
  }

  // 3 open bracket based logic
  if (validPreviousLine.length > 0 && bracketsArray) {
    for (const bracketConfig of bracketsArray) {
      const bracket = new BracketRule(bracketConfig);
      if (bracket.openRegExp && bracket.openRegExp.test(validPreviousLine)) {
        return vscode.IndentAction.Indent;
      }
    }
  }

  // 4 close bracket based logic
  if (currentLineWithoutLeadingWhiteSpaces.length > 0 && bracketsArray) {
    for (const bracketConfig of bracketsArray) {
      const bracket = new BracketRule(bracketConfig);
      if (bracket.closeRegExp && bracket.closeRegExp.test(currentLineWithoutLeadingWhiteSpaces)) {
        return vscode.IndentAction.Outdent;
      }
    }
  }

  // 5 indentRules based logic. not yet supported
  return vscode.IndentAction.None;
}

function escapeRegExpCharacters(s: string): string {
  return s.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
}

function createRegExp(s: string): RegExp | null {
  try {
    return new RegExp(s);
  } catch (err) {
    return null;
  }
}

function createOpenBracketRegExp(openBracket: string): RegExp | null {
  let str = escapeRegExpCharacters(openBracket);
  if (!/\B/.test(str.charAt(0))) {
    str = '\\b' + str;
  }
  str += '\\s*$';
  return createRegExp(str);
}

function createCloseBracketRegExp(closeBracket: string): RegExp | null {
  let str = escapeRegExpCharacters(closeBracket);
  if (!/\B/.test(str.charAt(str.length - 1))) {
    str = str + '\\b';
  }
  str = '^\\s*' + str;
  return createRegExp(str);
}

function getTabSize(languageId: string): number {
  // TODO: estimate from content
  return vscode.workspace.getConfiguration('editor', { languageId: languageId }).tabSize;
}

/**
 * @return {boolean} true if hard tab is configured.
 */
function isUsingHardTab(): boolean {
  // TODO: estimate from content
  return !vscode.workspace.getConfiguration('editor').insertSpaces;
}

/**
 * @param {string} indentLine
 * @param {number} tabSize
 * @return {number} indent level.
 */
function countIndent(indentLine: string, tabSize: number): number {
  const tabCount = (indentLine.match(/\t/g) || []).length;
  const spaceCount = (indentLine.match(/ /g) || []).length;
  const spaceCountAsIndent = spaceCount / tabSize;
  return tabCount + spaceCountAsIndent;
}

/**
 * @param {number} indentLevel
 * @param {number} tabSize
 * @return {string}
 */
function convertIndentLevelToString(
  indentLevel: number, tabSize: number): string {
  if (isUsingHardTab()) {
    return new Array(1 + indentLevel).join('\t');
  } else {
    return new Array(1 + indentLevel * tabSize).join(' ');
  }
}

/**
 * reindent current line
 * @param indentationRules
 * @param onEnterRulesArray
 */
export function reindentCurrentLine(
  indentAction: vscode.IndentAction, validPreviousLine: string,
  currentLine: string, languageId: string): void {
  const tabSize = getTabSize(languageId);
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }
  const currentPosition = editor.selection.active;
  const document = editor.document;

  const previousIndent = getIndent(validPreviousLine);
  const beforeIndentCurrentIndent =
    countIndent(getIndent(currentLine), tabSize);
  const beforeIndentCurrentIndentNative = getIndent(currentLine).length;
  const currentLineWithoutLeadingWhiteSpaces = currentLine.replace(/^\s*/, '');

  let idealIndent = countIndent(previousIndent, tabSize);
  if (indentAction === vscode.IndentAction.Indent) {
    idealIndent = 1 + idealIndent;
  } else if (indentAction === vscode.IndentAction.Outdent) {
    idealIndent = idealIndent - 1;
  } else if (indentAction === vscode.IndentAction.IndentOutdent) {
    idealIndent = 1 + idealIndent;
  }
  if (idealIndent < 0) {
    idealIndent = 0;
  }

  // before indent line, store the position of cursor
  const beforeIndentCursorPositionCharacter = currentPosition.character;
  if (idealIndent !== beforeIndentCurrentIndent) {
    var indentedCurrentLine = indentLine(
      currentLine, idealIndent, previousIndent,
      countIndent(previousIndent, tabSize), tabSize);
    if (vscode.window.activeTextEditor) {
      vscode.window.activeTextEditor.edit((edit) => {
        const startPosition = new vscode.Position(currentPosition.line, 0);
        const endPosition =
          new vscode.Position(currentPosition.line, currentLine.length);
        if (document.eol == 2 && 1 < indentedCurrentLine.length
          && currentLine.length != beforeIndentCurrentIndentNative) {
          indentedCurrentLine = indentedCurrentLine.substring(0, indentedCurrentLine.length - 1);
        }
        edit.replace(
          new vscode.Range(startPosition, endPosition), indentedCurrentLine);
      });
    }
  }

  // move cursor if needed
  if (beforeIndentCursorPositionCharacter < beforeIndentCurrentIndentNative) {
    // move to the first character of the line
    const nativeCharacterTabSize = isUsingHardTab() ? 1 : tabSize;
    const nextPosition = new vscode.Position(
      currentPosition.line, idealIndent * nativeCharacterTabSize);
    editor.selection = new vscode.Selection(nextPosition, nextPosition);
  } else if (idealIndent !== beforeIndentCurrentIndent) {
    const cursorMovement = (idealIndent - beforeIndentCurrentIndent) * tabSize;
    const nextPosition = new vscode.Position(
      currentPosition.line,
      cursorMovement + beforeIndentCursorPositionCharacter);
    editor.selection = new vscode.Selection(nextPosition, nextPosition);
  }
}

function getValidPreviousLine(
  allLinesArray: string[], currentLine: number): string {
  const isAllWhiteSpacesRegexp = /^\s*$/;
  for (let previousLine = currentLine - 1; previousLine >= 0; --previousLine) {
    const previousLineContent = allLinesArray[previousLine];
    if (previousLineContent.length > 0 &&
      !isAllWhiteSpacesRegexp.test(previousLineContent)) {
      return previousLineContent;
    }
  }
  return '';
}

function indentLine(
  line: string, indentLevel: number, previousIndent: string,
  previousIndentLevel: number, tabSize: number): string {
  const withoutLeadingWhiteSpacesLine = line.replace(/^[\s]*/, '');
  if (previousIndentLevel == indentLevel) {
    // If no need to change indent level, just use exactly the same indent to
    // the previous line.
    return previousIndent + withoutLeadingWhiteSpacesLine;
  } else {
    const additionalSpaces = convertIndentLevelToString(indentLevel, tabSize);
    return additionalSpaces + withoutLeadingWhiteSpacesLine;
  }
}

/**
 * get leading spaces.
 * @param {string} line
 * @return {string}
 */
function getIndent(line: string): string {
  const leadingWhiteSpacesRegexpResult = /^[\s]*/.exec(line);
  if (leadingWhiteSpacesRegexpResult) {
    const leadingWhiteSpaces = leadingWhiteSpacesRegexpResult[0];
    return leadingWhiteSpaces;
  } else {
    return '';
  }
}
