'use strict';
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

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
  public openRegExp: RegExp;
  public closeRegExp: RegExp;

  public constructor(config: IBracketRuleConfig) {
    this.openBracket = config[0];
    this.closeBracket = config[1];
    this.openRegExp = this.createOpenBracketRegExp(this.openBracket);
    this.closeRegExp = this.createCloseBracketRegExp(this.closeBracket);
  }

  private createOpenBracketRegExp(openBracket: string): RegExp {
    let str = escapeRegExpCharacters(openBracket);
    if (!/\B/.test(str.charAt(0))) {
      str = '\\b' + str;
    }
    str += '\\s*$';
    return createRegExp(str);
  }

  private createCloseBracketRegExp(closeBracket: string): RegExp {
    let str = escapeRegExpCharacters(closeBracket);
    if (!/\B/.test(str.charAt(str.length - 1))) {
      str = str + '\\b';
    }
    str = '^\\s*' + str;
    return createRegExp(str);
  }
}

class IndentationRule {
  private unIndentedLinePattern: RegExp;
  private increaseIndentPattern: RegExp;
  private decreaseIndentPattern: RegExp;
  private indentNextLinePattern: RegExp;

  public constructor(config: IIndentationRuleConfig) {
    this.unIndentedLinePattern =
        this.createRegExp(config && config.unIndentedLinePattern);
    this.increaseIndentPattern =
        this.createRegExp(config && config.increaseIndentPattern);
    this.decreaseIndentPattern =
        this.createRegExp(config && config.decreaseIndentPattern);
    this.indentNextLinePattern =
        this.createRegExp(config && config.indentNextLinePattern);
  }

  public testUnIndentedLinePattern(line: string): boolean {
    return this.unIndentedLinePattern && this.unIndentedLinePattern.test(line);
  }

  public testIncreaseIndentPattern(line: string): boolean {
    return this.increaseIndentPattern && this.increaseIndentPattern.test(line);
  }

  public testDecreaseIndentPattern(line: string): boolean {
    return this.decreaseIndentPattern && this.decreaseIndentPattern.test(line);
  }

  public testIndentNextLinePattern(line: string): boolean {
    return this.indentNextLinePattern && this.indentNextLinePattern.test(line);
  }

  public estimateIndentAction(validPreviousLine: string, currentLine: string):
      vscode.IndentAction {
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
    } else {
      return null;
    }
  }

  private createRegExp(s: string): RegExp {
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

const ADDITIONAL_CONFIGURATION_FOR_LANGUAGE: {[id: string]: ILanguageConfiguration;} = {
  python: {
     indentationRules: {
       increaseIndentPattern:
       '^\\s*(?:def|class|for|if|elif|else|while|try|with|finally|except|async).*?:\\s*$',
     },
  },
};

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  // The command has been defined in the package.json file
  // Now provide the impleme<ntation of the command with  registerCommand
  // The commandId parameter must match the command field in package.json
  const reindentCurrentLineCommand =
      vscode.commands.registerCommand('emacs-tab.reindentCurrentLine', () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          vscode.window.showInformationMessage('No editor');
          return;
        }
        const documentLanguageId: string = editor.document.languageId;
        const langConfig = getLanguageConfiguration(documentLanguageId);
        if (!langConfig) {
          vscode.window.showInformationMessage(
              `no language config for ${documentLanguageId}`);
          return;
        }
        const [previousValidLine, currentLine] =
            getPreviousAndCurrentLine(editor);
        const indent =
            estimateIndentAction(previousValidLine, currentLine, langConfig);
        reindentCurrentLine(indent, previousValidLine, currentLine);
      });

  const debugEstimateIndentLevel = vscode.commands.registerCommand(
      'emacs-tab.debugEstimateIndentLevel', () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          vscode.window.showInformationMessage('No editor');
          return;
        }
        const documentLanguageId: string = editor.document.languageId;
        const langConfig = getLanguageConfiguration(documentLanguageId);
        if (!langConfig) {
          vscode.window.showInformationMessage(
              `no language config for ${documentLanguageId}`);
          return;
        }
        const [previousValidLine, currentLine] =
            getPreviousAndCurrentLine(editor);
        const indent =
            estimateIndentAction(previousValidLine, currentLine, langConfig);
        vscode.window.showInformationMessage(
            convertIndentActionToString(indent));
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
  }
}

/**
 * @param {vscode.TextEditor} editor
 * @return {string[]} pair of the valid previous line and current line
 */
function getPreviousAndCurrentLine(editor: vscode.TextEditor): string[] {
  if (!editor.selection.isEmpty) {
    return [null, null];
  }

  const currentPosition = editor.selection.active;
  const document = editor.document;
  const allLinesArray = document.getText().split('\n');
  const currentLine = allLinesArray[currentPosition.line];
  if (currentPosition.line === 0) {
    // first line, do nothing
    return [null, currentLine];
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
      mergedConfiguration.indentationRules = Object.assign({},
        a.indentationRules, b.indentationRules);
    } else {
      mergedConfiguration.indentationRules = b.indentationRules;
    }
    if (a.brackets) {
      mergedConfiguration.brackets = a.brackets.concat(b.brackets || []);
    } else {
      mergedConfiguration.brackets = b.brackets;
    }
    if (a.onEnterRules) {
      mergedConfiguration.onEnterRules = a.onEnterRules.concat(b.onEnterRules || []);
    } else {
      mergedConfiguration.onEnterRules = b.onEnterRules;
    }
    return mergedConfiguration;
}

/**
 * @param id {string} id of language
 * @return {Object} return language configuration
 */
function getLanguageConfiguration(id: string): ILanguageConfiguration {
  const editor = vscode.window.activeTextEditor;
  const documentLanguageId: string = editor.document.languageId;
  let additionalConfiguration = {};
  if (documentLanguageId in ADDITIONAL_CONFIGURATION_FOR_LANGUAGE) {
    additionalConfiguration = ADDITIONAL_CONFIGURATION_FOR_LANGUAGE[documentLanguageId];
  }
  // walk through all the extensions
  for (const ext of vscode.extensions.all) {
    if (ext.packageJSON && ext.packageJSON.contributes &&
        ext.packageJSON.contributes.languages) {
      const packageLangData = ext.packageJSON.contributes.languages.find(
          (langData) => (langData.id === documentLanguageId));
      if (packageLangData) {
        const langConfigFilepath =
            path.join(ext.extensionPath, packageLangData.configuration);
        return mergeLanguageConfiguration(
          require(langConfigFilepath),
          additionalConfiguration);
      }
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
  const currentLineWihtoutLeadingWhitespaces = currentLine.replace(/^\s*/, '');
  // 0 indentPattern
  const indentationRule =
      new IndentationRule(languageConfiguration.indentationRules);
  const indentationRuleIndentAction =
      indentationRule.estimateIndentAction(validPreviousLine, currentLine);
  if (indentationRuleIndentAction != null) {
    return indentationRuleIndentAction;
  }
  // 1 regexp Rule, not yet supported
  /*
  for (const rule of onEnterRulesArray) {
    if (rule.beforeText.test(validPreviousLine)) {
      if (rule.afterText) {
        if (rule.afterText.test(currentLineWihtoutLeadingWhitespaces)) {
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
      currentLineWihtoutLeadingWhitespaces.length > 0) {
    for (const bracketConfig of bracketsArray) {
      const bracket = new BracketRule(bracketConfig);
      if (bracket.openRegExp.test(validPreviousLine) &&
          bracket.closeRegExp.test(currentLineWihtoutLeadingWhitespaces)) {
        return vscode.IndentAction.IndentOutdent;
      }
    }
  }

  // 3 open bracket based logic
  if (validPreviousLine.length > 0) {
    for (const bracketConfig of bracketsArray) {
      const bracket = new BracketRule(bracketConfig);
      if (bracket.openRegExp.test(validPreviousLine)) {
        return vscode.IndentAction.Indent;
      }
    }
  }

  // 4 close bracket based logic
  if (currentLineWihtoutLeadingWhitespaces.length > 0) {
    for (const bracketConfig of bracketsArray) {
      const bracket = new BracketRule(bracketConfig);
      if (bracket.closeRegExp.test(currentLineWihtoutLeadingWhitespaces)) {
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

function createRegExp(s: string): RegExp {
  try {
    return new RegExp(s);
  } catch (err) {
    return null;
  }
}

function createOpenBracketRegExp(openBracket: string): RegExp {
  let str = escapeRegExpCharacters(openBracket);
  if (!/\B/.test(str.charAt(0))) {
    str = '\\b' + str;
  }
  str += '\\s*$';
  return createRegExp(str);
}

function createCloseBracketRegExp(closeBracket: string): RegExp {
  let str = escapeRegExpCharacters(closeBracket);
  if (!/\B/.test(str.charAt(str.length - 1))) {
    str = str + '\\b';
  }
  str = '^\\s*' + str;
  return createRegExp(str);
}

/**
 * reindent current line
 * @param indentationRules
 * @param onEnterRulesArray
 */
export function reindentCurrentLine(
    indentAction: vscode.IndentAction, validPreviousLine: string,
    currentLine: string): void {
  // TODO: estimate from content
  const tabSize = vscode.workspace.getConfiguration('editor').tabSize;
  const editor = vscode.window.activeTextEditor;
  const currentPosition = editor.selection.active;
  const document = editor.document;

  const previousIndent = getIndent(validPreviousLine);
  const beforeIndentCurrentIndent = getIndent(currentLine).length;
  const currentLineWihtoutLeadingWhitespaces = currentLine.replace(/^\s*/, '');

  let idealIndent = previousIndent.length;
  if (indentAction === vscode.IndentAction.Indent) {
    idealIndent = tabSize + idealIndent;
  } else if (indentAction === vscode.IndentAction.Outdent) {
    idealIndent = idealIndent - tabSize;
  } else if (indentAction === vscode.IndentAction.IndentOutdent) {
    idealIndent = tabSize + idealIndent;
  }
  if (idealIndent < 0) {
    idealIndent = 0;
  }

  // before indent line, store the position of cursor
  const beforeIndentCursorPositionCharacter = currentPosition.character;
  if (idealIndent !== beforeIndentCurrentIndent) {
    const indentedCurrentLine = indentLine(currentLine, idealIndent);
    vscode.window.activeTextEditor.edit((edit) => {
      const startPosition = new vscode.Position(currentPosition.line, 0);
      const endPosition =
          new vscode.Position(currentPosition.line, currentLine.length);
      edit.replace(
          new vscode.Range(startPosition, endPosition), indentedCurrentLine);
    });
  }

  // move cursor
  if (beforeIndentCursorPositionCharacter < beforeIndentCurrentIndent) {
    // move to the first character of the line
    const nextPosition = new vscode.Position(currentPosition.line, idealIndent);
    editor.selection = new vscode.Selection(nextPosition, nextPosition);
  } else if (idealIndent !== beforeIndentCurrentIndent) {
    const cursorMovement = idealIndent - beforeIndentCurrentIndent;
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
  return null;
}

function indentLine(line: string, previousIndentLevel: number) {
  const withoutLeadingWhiteSpacesLine = line.replace(/^[\s]*/, '');
  const additionalSpaces = new Array(1 + previousIndentLevel).join(' ');
  return additionalSpaces + withoutLeadingWhiteSpacesLine;
}

/**
 * get leading speces.
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
