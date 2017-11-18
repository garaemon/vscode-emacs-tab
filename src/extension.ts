'use strict';
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import {createReadStream} from 'fs';


const DEFAULT_BRACKETS = [
  ['(', ')'],
  ['{', '}'],
  ['[', ']'],
];

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  // The command has been defined in the package.json file
  // Now provide the impleme<ntation of the command with  registerCommand
  // The commandId parameter must match the command field in package.json
  let disposable =
      vscode.commands.registerCommand('emacs-tab.reindentCurrentLine', () => {
        // The code you place here will be executed every time your command is
        // executed
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          return;
        }
        const documentLanguageId: string = editor.document.languageId;
        const langConfig = getLanguageConfiguration(documentLanguageId);
        if (!langConfig) {
          return;
        }
        reindentCurrentLine(
            langConfig.indentationRules, langConfig.onEnterRules,
            langConfig.brackets);
      });
  context.subscriptions.push(disposable);
}

/**
 *
 * @param id {string} id of language
 * @return {Object} return language configuration
 */
function getLanguageConfiguration(id: string) {
  const editor = vscode.window.activeTextEditor;
  const documentLanguageId: string = editor.document.languageId;
  // walk through all the extensions
  for (const _ext of vscode.extensions.all) {
    if (_ext.packageJSON && _ext.packageJSON.contributes &&
        _ext.packageJSON.contributes.languages) {
      const packageLangData = _ext.packageJSON.contributes.languages.find(
          _packageLangData => (_packageLangData.id === documentLanguageId));
      if (packageLangData) {
        const langConfigFilepath =
            path.join(_ext.extensionPath, packageLangData.configuration);
        return require(langConfigFilepath);
      }
    }
  }
  return null;
}

function estimateIndentAction(
    validPreviousLine: string, currentLineWihtoutLeadingWhitespaces: string,
    onEnterRulesArray, bracketsArray): vscode.IndentAction {
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
    for (const bracket of bracketsArray) {
      if (bracket.openRegExp.test(validPreviousLine) &&
          bracket.closeRegExp.test(currentLineWihtoutLeadingWhitespaces)) {
        return vscode.IndentAction.IndentOutdent;
      }
    }
  }
  // 3 open bracket based logic
  if (validPreviousLine.length > 0) {
    for (const bracket of bracketsArray) {
      if (bracket.openRegExp.test(validPreviousLine)) {
        return vscode.IndentAction.Indent;
      }
    }
  }

  // 4 close bracket based logic
  if (currentLineWihtoutLeadingWhitespaces.length > 0) {
    for (const bracket of bracketsArray) {
      if (bracket.closeRegExp.test(currentLineWihtoutLeadingWhitespaces)) {
        return vscode.IndentAction.Outdent;
      }
    }
  }

  // 5 indentRules based logic. not yet supported
  return null;
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
    indentationRules, onEnterRulesArray, bracketArrayFromConfig) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    // console.log('no editor');
    return;
  }
  if (!editor.selection.isEmpty) {
    // console.log('selected');
    return;
  }

  const currentPosition = editor.selection.active;
  if (currentPosition.line == 0) {
    // first line, do nothing
    // console.log('first line');
    return;
  }
  const document = editor.document;
  const allLinesArray = document.getText().split('\n');
  const currentLine = allLinesArray[currentPosition.line];
  // Lookup valid previous line because the line consisted of white spaces gives
  // no effect on indentation.
  const validPreviousLine =
      getValidPreviousLine(allLinesArray, currentPosition.line);
  if (validPreviousLine == null) {
    // console.log('no valid previous line');
    // no previous valid line means the current line is the first
    // valid line.
    return;
  }

  const previousIndent = getIndentSpaceNum(validPreviousLine);
  const beforeIndentCurrentIndent = getIndentSpaceNum(currentLine);
  const currentLineWihtoutLeadingWhitespaces = currentLine.replace(/^\s*/, '');
  const tabSize = vscode.workspace.getConfiguration('editor').tabSize;
  let idealIndent = previousIndent;
  const bracketsArray = bracketArrayFromConfig || DEFAULT_BRACKETS;
  const bracketsRegexpArray = bracketsArray.map((bracket) => {
    return {
      open: bracket[0],
      openRegExp: createOpenBracketRegExp(bracket[0]),
      close: bracket[1],
      closeRegExp: createCloseBracketRegExp(bracket[1]),
    };
  });
  const indentAction = estimateIndentAction(
      validPreviousLine, currentLineWihtoutLeadingWhitespaces,
      onEnterRulesArray, bracketsRegexpArray);
  if (indentAction == vscode.IndentAction.Indent) {
    // console.log('Indent');
    idealIndent = tabSize + idealIndent;
  } else if (indentAction == vscode.IndentAction.Outdent) {
    // console.log('outdent');
    idealIndent = idealIndent - tabSize;
  } else if (indentAction == vscode.IndentAction.IndentOutdent) {
    // console.log('indentoutdent');
    idealIndent = tabSize + idealIndent;
  } else {
    // console.log('no indent');
  }

  // before indent line, store the position of cursor
  const beforeIndentCursorPositionCharacter = currentPosition.character;
  if (idealIndent != beforeIndentCurrentIndent) {
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
  } else if (idealIndent != beforeIndentCurrentIndent) {
    const cursorMovement = idealIndent - beforeIndentCurrentIndent;
    const nextPosition = new vscode.Position(
        currentPosition.line,
        cursorMovement + beforeIndentCursorPositionCharacter);
    editor.selection = new vscode.Selection(nextPosition, nextPosition);
  }
}

function getValidPreviousLine(
    allLinesArray: Array<string>, currentLine: number): string {
  const isAllWhiteSpacesRegexp = /^\s*$/;
  for (let previousLine = currentLine - 1; previousLine >= 0; --previousLine) {
    const previousLineContent = allLinesArray[previousLine];
    // console.log(`previousLineContent => ${previousLineContent}`);
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

function getIndentSpaceNum(line: string): number {
  const leadingWhiteSpacesRegexpResult = /^[\s]*/.exec(line);
  if (leadingWhiteSpacesRegexpResult) {
    const leadingWhiteSpaces = leadingWhiteSpacesRegexpResult[0];
    return leadingWhiteSpaces.length;
  } else {
    return 0;
  }
}
