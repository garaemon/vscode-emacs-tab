'use strict';
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { createReadStream } from 'fs';

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
    // The command has been defined in the package.json file
    // Now provide the impleme<ntation of the command with  registerCommand
    // The commandId parameter must match the command field in package.json
    let disposable = vscode.commands.registerCommand('emacs-tab.reindentCurrentLine', () => {
        // The code you place here will be executed every time your command is executed
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }
        const documentLanguageId:string = editor.document.languageId;
        const langConfig = getLanguageConfiguration(documentLanguageId);
        if (!langConfig) {
            return;
        }
        console.log(langConfig);
        if (langConfig.indentationRules) {
          reindentCurrentLine(langConfig.indentationRules);
        }
    });

    context.subscriptions.push(disposable);
}

/**
 *
 * @param id {string} id of language
 * @return {Object} return language configuration
 */
function getLanguageConfiguration(id: string): Object {
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

function createRegExpFromString(pattern: string): RegExp {
    if (pattern) {
        return new RegExp(pattern);
    }
    return null;
}

/**
 * reindent current line
 * @param indentationRules {Object}
 */
export function reindentCurrentLine(indentationRules: Object) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        return;
    }
    if (!editor.selection.isEmpty) {
        return;
    }
    const unIndentedLinePattern = createRegExpFromString(indentationRules.unIndentedLinePattern);
    const increaseIndentPattern = createRegExpFromString(indentationRules.increaseIndentPattern);
    const decreaseIndentPattern = createRegExpFromString(indentationRules.decreaseIndentPattern);
    const indentNextLinePattern = createRegExpFromString(indentationRules.indentNextLinePattern);

    const currentPosition = editor.selection.active;
    if (currentPosition.line == 0) {
        // first line, do nothing
        return;
    }
    const document = editor.document;
    const allLinesArray = document.getText().split('\n');
    const currentLine = allLinesArray[currentPosition.line];
    // Lookup valid previous line because the line consisted of white spaces gives no effect
    // on indentation.
    const validPreviousLine = getValidPreviousLine(allLinesArray, currentPosition.line);
    if (validPreviousLine == null) {
        // no previous valid line means the current line is the first
        // valid line.
        return;
    }

    const previousIndent = getIndentSpaceNum(validPreviousLine);
    const beforeIndentCurrentIndent = getIndentSpaceNum(currentLine);
    const tabSize = vscode.workspace.getConfiguration('editor').tabSize;
    let idealIndent = previousIndent;

    if (unIndentedLinePattern && unIndentedLinePattern.test(validPreviousLine)) {
        // do nothing
    } else if (increaseIndentPattern && increaseIndentPattern.test(validPreviousLine)) {
        idealIndent = tabSize + idealIndent;
    } else if (indentNextLinePattern && indentNextLinePattern.test(validPreviousLine)) {
        idealIndent = tabSize + idealIndent;
    }

    if (decreaseIndentPattern && decreaseIndentPattern.test(currentLine)) {
        idealIndent = idealIndent - tabSize;
    }

    // before indent line, store the position of cursor
    const beforeIndentCursorPositionCharacter = currentPosition.character;
    if (idealIndent != beforeIndentCurrentIndent) {
        const indentedCurrentLine = indentLine(currentLine, idealIndent);
        vscode.window.activeTextEditor.edit((edit) => {
            const startPosition = new vscode.Position(currentPosition.line, 0);
            const endPosition = new vscode.Position(currentPosition.line, currentLine.length);
            edit.replace(new vscode.Range(startPosition, endPosition), indentedCurrentLine);
        });
    }

    // move cursor
    if (beforeIndentCursorPositionCharacter < beforeIndentCurrentIndent) {
        // move to the first character of the line
        const nextPosition = new vscode.Position(currentPosition.line, idealIndent);
        editor.selection = new vscode.Selection(nextPosition, nextPosition);
    } else if (idealIndent != beforeIndentCurrentIndent) {
        const cursorMovement = idealIndent - beforeIndentCurrentIndent;
        const nextPosition = new vscode.Position(currentPosition.line,
                                                 cursorMovement + beforeIndentCursorPositionCharacter);
        editor.selection = new vscode.Selection(nextPosition, nextPosition);
    }
}

function getValidPreviousLine(allLinesArray: Array<string>, currentLine: number): string {
    const isAllWhiteSpacesRegexp = /^[\s]*$/;
    for (let previousLine = currentLine - 1; previousLine > 0; --previousLine) {
        const previousLineContent = allLinesArray[previousLine];
        if (previousLineContent.length > 0 && !isAllWhiteSpacesRegexp.test(previousLineContent)) {
            return previousLineContent;
        }
    }
    return null;
}

export function indentLine(line: string, previousIndentLevel: number) {
    const withoutLeadingWhiteSpacesLine = line.replace(/^[\s]*/, '');
    const additionalSpaces = new Array(1 + previousIndentLevel).join(' ');
    return additionalSpaces + withoutLeadingWhiteSpacesLine;
}

export function getIndentSpaceNum(line: string): number {
    const leadingWhiteSpacesRegexpResult = /^[\s]*/.exec(line);
    if (leadingWhiteSpacesRegexpResult) {
        const leadingWhiteSpaces = leadingWhiteSpacesRegexpResult[0];
        return leadingWhiteSpaces.length;
    } else {
        return 0;
    }
}