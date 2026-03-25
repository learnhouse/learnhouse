#!/usr/bin/env node
import { createRequire as __createRequire } from "module";
const require = __createRequire(import.meta.url);
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __require = /* @__PURE__ */ ((x3) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x3, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x3)(function(x3) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x3 + '" is not supported');
});
var __commonJS = (cb, mod) => function __require2() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/commander/lib/error.js
var require_error = __commonJS({
  "node_modules/commander/lib/error.js"(exports) {
    "use strict";
    var CommanderError2 = class extends Error {
      /**
       * Constructs the CommanderError class
       * @param {number} exitCode suggested exit code which could be used with process.exit
       * @param {string} code an id string representing the error
       * @param {string} message human-readable description of the error
       */
      constructor(exitCode, code, message) {
        super(message);
        Error.captureStackTrace(this, this.constructor);
        this.name = this.constructor.name;
        this.code = code;
        this.exitCode = exitCode;
        this.nestedError = void 0;
      }
    };
    var InvalidArgumentError2 = class extends CommanderError2 {
      /**
       * Constructs the InvalidArgumentError class
       * @param {string} [message] explanation of why argument is invalid
       */
      constructor(message) {
        super(1, "commander.invalidArgument", message);
        Error.captureStackTrace(this, this.constructor);
        this.name = this.constructor.name;
      }
    };
    exports.CommanderError = CommanderError2;
    exports.InvalidArgumentError = InvalidArgumentError2;
  }
});

// node_modules/commander/lib/argument.js
var require_argument = __commonJS({
  "node_modules/commander/lib/argument.js"(exports) {
    "use strict";
    var { InvalidArgumentError: InvalidArgumentError2 } = require_error();
    var Argument2 = class {
      /**
       * Initialize a new command argument with the given name and description.
       * The default is that the argument is required, and you can explicitly
       * indicate this with <> around the name. Put [] around the name for an optional argument.
       *
       * @param {string} name
       * @param {string} [description]
       */
      constructor(name, description) {
        this.description = description || "";
        this.variadic = false;
        this.parseArg = void 0;
        this.defaultValue = void 0;
        this.defaultValueDescription = void 0;
        this.argChoices = void 0;
        switch (name[0]) {
          case "<":
            this.required = true;
            this._name = name.slice(1, -1);
            break;
          case "[":
            this.required = false;
            this._name = name.slice(1, -1);
            break;
          default:
            this.required = true;
            this._name = name;
            break;
        }
        if (this._name.endsWith("...")) {
          this.variadic = true;
          this._name = this._name.slice(0, -3);
        }
      }
      /**
       * Return argument name.
       *
       * @return {string}
       */
      name() {
        return this._name;
      }
      /**
       * @package
       */
      _collectValue(value, previous) {
        if (previous === this.defaultValue || !Array.isArray(previous)) {
          return [value];
        }
        previous.push(value);
        return previous;
      }
      /**
       * Set the default value, and optionally supply the description to be displayed in the help.
       *
       * @param {*} value
       * @param {string} [description]
       * @return {Argument}
       */
      default(value, description) {
        this.defaultValue = value;
        this.defaultValueDescription = description;
        return this;
      }
      /**
       * Set the custom handler for processing CLI command arguments into argument values.
       *
       * @param {Function} [fn]
       * @return {Argument}
       */
      argParser(fn) {
        this.parseArg = fn;
        return this;
      }
      /**
       * Only allow argument value to be one of choices.
       *
       * @param {string[]} values
       * @return {Argument}
       */
      choices(values) {
        this.argChoices = values.slice();
        this.parseArg = (arg, previous) => {
          if (!this.argChoices.includes(arg)) {
            throw new InvalidArgumentError2(
              `Allowed choices are ${this.argChoices.join(", ")}.`
            );
          }
          if (this.variadic) {
            return this._collectValue(arg, previous);
          }
          return arg;
        };
        return this;
      }
      /**
       * Make argument required.
       *
       * @returns {Argument}
       */
      argRequired() {
        this.required = true;
        return this;
      }
      /**
       * Make argument optional.
       *
       * @returns {Argument}
       */
      argOptional() {
        this.required = false;
        return this;
      }
    };
    function humanReadableArgName(arg) {
      const nameOutput = arg.name() + (arg.variadic === true ? "..." : "");
      return arg.required ? "<" + nameOutput + ">" : "[" + nameOutput + "]";
    }
    exports.Argument = Argument2;
    exports.humanReadableArgName = humanReadableArgName;
  }
});

// node_modules/commander/lib/help.js
var require_help = __commonJS({
  "node_modules/commander/lib/help.js"(exports) {
    "use strict";
    var { humanReadableArgName } = require_argument();
    var Help2 = class {
      constructor() {
        this.helpWidth = void 0;
        this.minWidthToWrap = 40;
        this.sortSubcommands = false;
        this.sortOptions = false;
        this.showGlobalOptions = false;
      }
      /**
       * prepareContext is called by Commander after applying overrides from `Command.configureHelp()`
       * and just before calling `formatHelp()`.
       *
       * Commander just uses the helpWidth and the rest is provided for optional use by more complex subclasses.
       *
       * @param {{ error?: boolean, helpWidth?: number, outputHasColors?: boolean }} contextOptions
       */
      prepareContext(contextOptions) {
        this.helpWidth = this.helpWidth ?? contextOptions.helpWidth ?? 80;
      }
      /**
       * Get an array of the visible subcommands. Includes a placeholder for the implicit help command, if there is one.
       *
       * @param {Command} cmd
       * @returns {Command[]}
       */
      visibleCommands(cmd) {
        const visibleCommands = cmd.commands.filter((cmd2) => !cmd2._hidden);
        const helpCommand = cmd._getHelpCommand();
        if (helpCommand && !helpCommand._hidden) {
          visibleCommands.push(helpCommand);
        }
        if (this.sortSubcommands) {
          visibleCommands.sort((a, b) => {
            return a.name().localeCompare(b.name());
          });
        }
        return visibleCommands;
      }
      /**
       * Compare options for sort.
       *
       * @param {Option} a
       * @param {Option} b
       * @returns {number}
       */
      compareOptions(a, b) {
        const getSortKey = (option) => {
          return option.short ? option.short.replace(/^-/, "") : option.long.replace(/^--/, "");
        };
        return getSortKey(a).localeCompare(getSortKey(b));
      }
      /**
       * Get an array of the visible options. Includes a placeholder for the implicit help option, if there is one.
       *
       * @param {Command} cmd
       * @returns {Option[]}
       */
      visibleOptions(cmd) {
        const visibleOptions = cmd.options.filter((option) => !option.hidden);
        const helpOption = cmd._getHelpOption();
        if (helpOption && !helpOption.hidden) {
          const removeShort = helpOption.short && cmd._findOption(helpOption.short);
          const removeLong = helpOption.long && cmd._findOption(helpOption.long);
          if (!removeShort && !removeLong) {
            visibleOptions.push(helpOption);
          } else if (helpOption.long && !removeLong) {
            visibleOptions.push(
              cmd.createOption(helpOption.long, helpOption.description)
            );
          } else if (helpOption.short && !removeShort) {
            visibleOptions.push(
              cmd.createOption(helpOption.short, helpOption.description)
            );
          }
        }
        if (this.sortOptions) {
          visibleOptions.sort(this.compareOptions);
        }
        return visibleOptions;
      }
      /**
       * Get an array of the visible global options. (Not including help.)
       *
       * @param {Command} cmd
       * @returns {Option[]}
       */
      visibleGlobalOptions(cmd) {
        if (!this.showGlobalOptions) return [];
        const globalOptions = [];
        for (let ancestorCmd = cmd.parent; ancestorCmd; ancestorCmd = ancestorCmd.parent) {
          const visibleOptions = ancestorCmd.options.filter(
            (option) => !option.hidden
          );
          globalOptions.push(...visibleOptions);
        }
        if (this.sortOptions) {
          globalOptions.sort(this.compareOptions);
        }
        return globalOptions;
      }
      /**
       * Get an array of the arguments if any have a description.
       *
       * @param {Command} cmd
       * @returns {Argument[]}
       */
      visibleArguments(cmd) {
        if (cmd._argsDescription) {
          cmd.registeredArguments.forEach((argument) => {
            argument.description = argument.description || cmd._argsDescription[argument.name()] || "";
          });
        }
        if (cmd.registeredArguments.find((argument) => argument.description)) {
          return cmd.registeredArguments;
        }
        return [];
      }
      /**
       * Get the command term to show in the list of subcommands.
       *
       * @param {Command} cmd
       * @returns {string}
       */
      subcommandTerm(cmd) {
        const args = cmd.registeredArguments.map((arg) => humanReadableArgName(arg)).join(" ");
        return cmd._name + (cmd._aliases[0] ? "|" + cmd._aliases[0] : "") + (cmd.options.length ? " [options]" : "") + // simplistic check for non-help option
        (args ? " " + args : "");
      }
      /**
       * Get the option term to show in the list of options.
       *
       * @param {Option} option
       * @returns {string}
       */
      optionTerm(option) {
        return option.flags;
      }
      /**
       * Get the argument term to show in the list of arguments.
       *
       * @param {Argument} argument
       * @returns {string}
       */
      argumentTerm(argument) {
        return argument.name();
      }
      /**
       * Get the longest command term length.
       *
       * @param {Command} cmd
       * @param {Help} helper
       * @returns {number}
       */
      longestSubcommandTermLength(cmd, helper) {
        return helper.visibleCommands(cmd).reduce((max, command) => {
          return Math.max(
            max,
            this.displayWidth(
              helper.styleSubcommandTerm(helper.subcommandTerm(command))
            )
          );
        }, 0);
      }
      /**
       * Get the longest option term length.
       *
       * @param {Command} cmd
       * @param {Help} helper
       * @returns {number}
       */
      longestOptionTermLength(cmd, helper) {
        return helper.visibleOptions(cmd).reduce((max, option) => {
          return Math.max(
            max,
            this.displayWidth(helper.styleOptionTerm(helper.optionTerm(option)))
          );
        }, 0);
      }
      /**
       * Get the longest global option term length.
       *
       * @param {Command} cmd
       * @param {Help} helper
       * @returns {number}
       */
      longestGlobalOptionTermLength(cmd, helper) {
        return helper.visibleGlobalOptions(cmd).reduce((max, option) => {
          return Math.max(
            max,
            this.displayWidth(helper.styleOptionTerm(helper.optionTerm(option)))
          );
        }, 0);
      }
      /**
       * Get the longest argument term length.
       *
       * @param {Command} cmd
       * @param {Help} helper
       * @returns {number}
       */
      longestArgumentTermLength(cmd, helper) {
        return helper.visibleArguments(cmd).reduce((max, argument) => {
          return Math.max(
            max,
            this.displayWidth(
              helper.styleArgumentTerm(helper.argumentTerm(argument))
            )
          );
        }, 0);
      }
      /**
       * Get the command usage to be displayed at the top of the built-in help.
       *
       * @param {Command} cmd
       * @returns {string}
       */
      commandUsage(cmd) {
        let cmdName = cmd._name;
        if (cmd._aliases[0]) {
          cmdName = cmdName + "|" + cmd._aliases[0];
        }
        let ancestorCmdNames = "";
        for (let ancestorCmd = cmd.parent; ancestorCmd; ancestorCmd = ancestorCmd.parent) {
          ancestorCmdNames = ancestorCmd.name() + " " + ancestorCmdNames;
        }
        return ancestorCmdNames + cmdName + " " + cmd.usage();
      }
      /**
       * Get the description for the command.
       *
       * @param {Command} cmd
       * @returns {string}
       */
      commandDescription(cmd) {
        return cmd.description();
      }
      /**
       * Get the subcommand summary to show in the list of subcommands.
       * (Fallback to description for backwards compatibility.)
       *
       * @param {Command} cmd
       * @returns {string}
       */
      subcommandDescription(cmd) {
        return cmd.summary() || cmd.description();
      }
      /**
       * Get the option description to show in the list of options.
       *
       * @param {Option} option
       * @return {string}
       */
      optionDescription(option) {
        const extraInfo = [];
        if (option.argChoices) {
          extraInfo.push(
            // use stringify to match the display of the default value
            `choices: ${option.argChoices.map((choice) => JSON.stringify(choice)).join(", ")}`
          );
        }
        if (option.defaultValue !== void 0) {
          const showDefault = option.required || option.optional || option.isBoolean() && typeof option.defaultValue === "boolean";
          if (showDefault) {
            extraInfo.push(
              `default: ${option.defaultValueDescription || JSON.stringify(option.defaultValue)}`
            );
          }
        }
        if (option.presetArg !== void 0 && option.optional) {
          extraInfo.push(`preset: ${JSON.stringify(option.presetArg)}`);
        }
        if (option.envVar !== void 0) {
          extraInfo.push(`env: ${option.envVar}`);
        }
        if (extraInfo.length > 0) {
          const extraDescription = `(${extraInfo.join(", ")})`;
          if (option.description) {
            return `${option.description} ${extraDescription}`;
          }
          return extraDescription;
        }
        return option.description;
      }
      /**
       * Get the argument description to show in the list of arguments.
       *
       * @param {Argument} argument
       * @return {string}
       */
      argumentDescription(argument) {
        const extraInfo = [];
        if (argument.argChoices) {
          extraInfo.push(
            // use stringify to match the display of the default value
            `choices: ${argument.argChoices.map((choice) => JSON.stringify(choice)).join(", ")}`
          );
        }
        if (argument.defaultValue !== void 0) {
          extraInfo.push(
            `default: ${argument.defaultValueDescription || JSON.stringify(argument.defaultValue)}`
          );
        }
        if (extraInfo.length > 0) {
          const extraDescription = `(${extraInfo.join(", ")})`;
          if (argument.description) {
            return `${argument.description} ${extraDescription}`;
          }
          return extraDescription;
        }
        return argument.description;
      }
      /**
       * Format a list of items, given a heading and an array of formatted items.
       *
       * @param {string} heading
       * @param {string[]} items
       * @param {Help} helper
       * @returns string[]
       */
      formatItemList(heading, items, helper) {
        if (items.length === 0) return [];
        return [helper.styleTitle(heading), ...items, ""];
      }
      /**
       * Group items by their help group heading.
       *
       * @param {Command[] | Option[]} unsortedItems
       * @param {Command[] | Option[]} visibleItems
       * @param {Function} getGroup
       * @returns {Map<string, Command[] | Option[]>}
       */
      groupItems(unsortedItems, visibleItems, getGroup) {
        const result = /* @__PURE__ */ new Map();
        unsortedItems.forEach((item) => {
          const group = getGroup(item);
          if (!result.has(group)) result.set(group, []);
        });
        visibleItems.forEach((item) => {
          const group = getGroup(item);
          if (!result.has(group)) {
            result.set(group, []);
          }
          result.get(group).push(item);
        });
        return result;
      }
      /**
       * Generate the built-in help text.
       *
       * @param {Command} cmd
       * @param {Help} helper
       * @returns {string}
       */
      formatHelp(cmd, helper) {
        const termWidth = helper.padWidth(cmd, helper);
        const helpWidth = helper.helpWidth ?? 80;
        function callFormatItem(term, description) {
          return helper.formatItem(term, termWidth, description, helper);
        }
        let output = [
          `${helper.styleTitle("Usage:")} ${helper.styleUsage(helper.commandUsage(cmd))}`,
          ""
        ];
        const commandDescription = helper.commandDescription(cmd);
        if (commandDescription.length > 0) {
          output = output.concat([
            helper.boxWrap(
              helper.styleCommandDescription(commandDescription),
              helpWidth
            ),
            ""
          ]);
        }
        const argumentList = helper.visibleArguments(cmd).map((argument) => {
          return callFormatItem(
            helper.styleArgumentTerm(helper.argumentTerm(argument)),
            helper.styleArgumentDescription(helper.argumentDescription(argument))
          );
        });
        output = output.concat(
          this.formatItemList("Arguments:", argumentList, helper)
        );
        const optionGroups = this.groupItems(
          cmd.options,
          helper.visibleOptions(cmd),
          (option) => option.helpGroupHeading ?? "Options:"
        );
        optionGroups.forEach((options, group) => {
          const optionList = options.map((option) => {
            return callFormatItem(
              helper.styleOptionTerm(helper.optionTerm(option)),
              helper.styleOptionDescription(helper.optionDescription(option))
            );
          });
          output = output.concat(this.formatItemList(group, optionList, helper));
        });
        if (helper.showGlobalOptions) {
          const globalOptionList = helper.visibleGlobalOptions(cmd).map((option) => {
            return callFormatItem(
              helper.styleOptionTerm(helper.optionTerm(option)),
              helper.styleOptionDescription(helper.optionDescription(option))
            );
          });
          output = output.concat(
            this.formatItemList("Global Options:", globalOptionList, helper)
          );
        }
        const commandGroups = this.groupItems(
          cmd.commands,
          helper.visibleCommands(cmd),
          (sub) => sub.helpGroup() || "Commands:"
        );
        commandGroups.forEach((commands, group) => {
          const commandList = commands.map((sub) => {
            return callFormatItem(
              helper.styleSubcommandTerm(helper.subcommandTerm(sub)),
              helper.styleSubcommandDescription(helper.subcommandDescription(sub))
            );
          });
          output = output.concat(this.formatItemList(group, commandList, helper));
        });
        return output.join("\n");
      }
      /**
       * Return display width of string, ignoring ANSI escape sequences. Used in padding and wrapping calculations.
       *
       * @param {string} str
       * @returns {number}
       */
      displayWidth(str) {
        return stripColor(str).length;
      }
      /**
       * Style the title for displaying in the help. Called with 'Usage:', 'Options:', etc.
       *
       * @param {string} str
       * @returns {string}
       */
      styleTitle(str) {
        return str;
      }
      styleUsage(str) {
        return str.split(" ").map((word) => {
          if (word === "[options]") return this.styleOptionText(word);
          if (word === "[command]") return this.styleSubcommandText(word);
          if (word[0] === "[" || word[0] === "<")
            return this.styleArgumentText(word);
          return this.styleCommandText(word);
        }).join(" ");
      }
      styleCommandDescription(str) {
        return this.styleDescriptionText(str);
      }
      styleOptionDescription(str) {
        return this.styleDescriptionText(str);
      }
      styleSubcommandDescription(str) {
        return this.styleDescriptionText(str);
      }
      styleArgumentDescription(str) {
        return this.styleDescriptionText(str);
      }
      styleDescriptionText(str) {
        return str;
      }
      styleOptionTerm(str) {
        return this.styleOptionText(str);
      }
      styleSubcommandTerm(str) {
        return str.split(" ").map((word) => {
          if (word === "[options]") return this.styleOptionText(word);
          if (word[0] === "[" || word[0] === "<")
            return this.styleArgumentText(word);
          return this.styleSubcommandText(word);
        }).join(" ");
      }
      styleArgumentTerm(str) {
        return this.styleArgumentText(str);
      }
      styleOptionText(str) {
        return str;
      }
      styleArgumentText(str) {
        return str;
      }
      styleSubcommandText(str) {
        return str;
      }
      styleCommandText(str) {
        return str;
      }
      /**
       * Calculate the pad width from the maximum term length.
       *
       * @param {Command} cmd
       * @param {Help} helper
       * @returns {number}
       */
      padWidth(cmd, helper) {
        return Math.max(
          helper.longestOptionTermLength(cmd, helper),
          helper.longestGlobalOptionTermLength(cmd, helper),
          helper.longestSubcommandTermLength(cmd, helper),
          helper.longestArgumentTermLength(cmd, helper)
        );
      }
      /**
       * Detect manually wrapped and indented strings by checking for line break followed by whitespace.
       *
       * @param {string} str
       * @returns {boolean}
       */
      preformatted(str) {
        return /\n[^\S\r\n]/.test(str);
      }
      /**
       * Format the "item", which consists of a term and description. Pad the term and wrap the description, indenting the following lines.
       *
       * So "TTT", 5, "DDD DDDD DD DDD" might be formatted for this.helpWidth=17 like so:
       *   TTT  DDD DDDD
       *        DD DDD
       *
       * @param {string} term
       * @param {number} termWidth
       * @param {string} description
       * @param {Help} helper
       * @returns {string}
       */
      formatItem(term, termWidth, description, helper) {
        const itemIndent = 2;
        const itemIndentStr = " ".repeat(itemIndent);
        if (!description) return itemIndentStr + term;
        const paddedTerm = term.padEnd(
          termWidth + term.length - helper.displayWidth(term)
        );
        const spacerWidth = 2;
        const helpWidth = this.helpWidth ?? 80;
        const remainingWidth = helpWidth - termWidth - spacerWidth - itemIndent;
        let formattedDescription;
        if (remainingWidth < this.minWidthToWrap || helper.preformatted(description)) {
          formattedDescription = description;
        } else {
          const wrappedDescription = helper.boxWrap(description, remainingWidth);
          formattedDescription = wrappedDescription.replace(
            /\n/g,
            "\n" + " ".repeat(termWidth + spacerWidth)
          );
        }
        return itemIndentStr + paddedTerm + " ".repeat(spacerWidth) + formattedDescription.replace(/\n/g, `
${itemIndentStr}`);
      }
      /**
       * Wrap a string at whitespace, preserving existing line breaks.
       * Wrapping is skipped if the width is less than `minWidthToWrap`.
       *
       * @param {string} str
       * @param {number} width
       * @returns {string}
       */
      boxWrap(str, width) {
        if (width < this.minWidthToWrap) return str;
        const rawLines = str.split(/\r\n|\n/);
        const chunkPattern = /[\s]*[^\s]+/g;
        const wrappedLines = [];
        rawLines.forEach((line) => {
          const chunks = line.match(chunkPattern);
          if (chunks === null) {
            wrappedLines.push("");
            return;
          }
          let sumChunks = [chunks.shift()];
          let sumWidth = this.displayWidth(sumChunks[0]);
          chunks.forEach((chunk) => {
            const visibleWidth = this.displayWidth(chunk);
            if (sumWidth + visibleWidth <= width) {
              sumChunks.push(chunk);
              sumWidth += visibleWidth;
              return;
            }
            wrappedLines.push(sumChunks.join(""));
            const nextChunk = chunk.trimStart();
            sumChunks = [nextChunk];
            sumWidth = this.displayWidth(nextChunk);
          });
          wrappedLines.push(sumChunks.join(""));
        });
        return wrappedLines.join("\n");
      }
    };
    function stripColor(str) {
      const sgrPattern = /\x1b\[\d*(;\d*)*m/g;
      return str.replace(sgrPattern, "");
    }
    exports.Help = Help2;
    exports.stripColor = stripColor;
  }
});

// node_modules/commander/lib/option.js
var require_option = __commonJS({
  "node_modules/commander/lib/option.js"(exports) {
    "use strict";
    var { InvalidArgumentError: InvalidArgumentError2 } = require_error();
    var Option2 = class {
      /**
       * Initialize a new `Option` with the given `flags` and `description`.
       *
       * @param {string} flags
       * @param {string} [description]
       */
      constructor(flags, description) {
        this.flags = flags;
        this.description = description || "";
        this.required = flags.includes("<");
        this.optional = flags.includes("[");
        this.variadic = /\w\.\.\.[>\]]$/.test(flags);
        this.mandatory = false;
        const optionFlags = splitOptionFlags(flags);
        this.short = optionFlags.shortFlag;
        this.long = optionFlags.longFlag;
        this.negate = false;
        if (this.long) {
          this.negate = this.long.startsWith("--no-");
        }
        this.defaultValue = void 0;
        this.defaultValueDescription = void 0;
        this.presetArg = void 0;
        this.envVar = void 0;
        this.parseArg = void 0;
        this.hidden = false;
        this.argChoices = void 0;
        this.conflictsWith = [];
        this.implied = void 0;
        this.helpGroupHeading = void 0;
      }
      /**
       * Set the default value, and optionally supply the description to be displayed in the help.
       *
       * @param {*} value
       * @param {string} [description]
       * @return {Option}
       */
      default(value, description) {
        this.defaultValue = value;
        this.defaultValueDescription = description;
        return this;
      }
      /**
       * Preset to use when option used without option-argument, especially optional but also boolean and negated.
       * The custom processing (parseArg) is called.
       *
       * @example
       * new Option('--color').default('GREYSCALE').preset('RGB');
       * new Option('--donate [amount]').preset('20').argParser(parseFloat);
       *
       * @param {*} arg
       * @return {Option}
       */
      preset(arg) {
        this.presetArg = arg;
        return this;
      }
      /**
       * Add option name(s) that conflict with this option.
       * An error will be displayed if conflicting options are found during parsing.
       *
       * @example
       * new Option('--rgb').conflicts('cmyk');
       * new Option('--js').conflicts(['ts', 'jsx']);
       *
       * @param {(string | string[])} names
       * @return {Option}
       */
      conflicts(names) {
        this.conflictsWith = this.conflictsWith.concat(names);
        return this;
      }
      /**
       * Specify implied option values for when this option is set and the implied options are not.
       *
       * The custom processing (parseArg) is not called on the implied values.
       *
       * @example
       * program
       *   .addOption(new Option('--log', 'write logging information to file'))
       *   .addOption(new Option('--trace', 'log extra details').implies({ log: 'trace.txt' }));
       *
       * @param {object} impliedOptionValues
       * @return {Option}
       */
      implies(impliedOptionValues) {
        let newImplied = impliedOptionValues;
        if (typeof impliedOptionValues === "string") {
          newImplied = { [impliedOptionValues]: true };
        }
        this.implied = Object.assign(this.implied || {}, newImplied);
        return this;
      }
      /**
       * Set environment variable to check for option value.
       *
       * An environment variable is only used if when processed the current option value is
       * undefined, or the source of the current value is 'default' or 'config' or 'env'.
       *
       * @param {string} name
       * @return {Option}
       */
      env(name) {
        this.envVar = name;
        return this;
      }
      /**
       * Set the custom handler for processing CLI option arguments into option values.
       *
       * @param {Function} [fn]
       * @return {Option}
       */
      argParser(fn) {
        this.parseArg = fn;
        return this;
      }
      /**
       * Whether the option is mandatory and must have a value after parsing.
       *
       * @param {boolean} [mandatory=true]
       * @return {Option}
       */
      makeOptionMandatory(mandatory = true) {
        this.mandatory = !!mandatory;
        return this;
      }
      /**
       * Hide option in help.
       *
       * @param {boolean} [hide=true]
       * @return {Option}
       */
      hideHelp(hide = true) {
        this.hidden = !!hide;
        return this;
      }
      /**
       * @package
       */
      _collectValue(value, previous) {
        if (previous === this.defaultValue || !Array.isArray(previous)) {
          return [value];
        }
        previous.push(value);
        return previous;
      }
      /**
       * Only allow option value to be one of choices.
       *
       * @param {string[]} values
       * @return {Option}
       */
      choices(values) {
        this.argChoices = values.slice();
        this.parseArg = (arg, previous) => {
          if (!this.argChoices.includes(arg)) {
            throw new InvalidArgumentError2(
              `Allowed choices are ${this.argChoices.join(", ")}.`
            );
          }
          if (this.variadic) {
            return this._collectValue(arg, previous);
          }
          return arg;
        };
        return this;
      }
      /**
       * Return option name.
       *
       * @return {string}
       */
      name() {
        if (this.long) {
          return this.long.replace(/^--/, "");
        }
        return this.short.replace(/^-/, "");
      }
      /**
       * Return option name, in a camelcase format that can be used
       * as an object attribute key.
       *
       * @return {string}
       */
      attributeName() {
        if (this.negate) {
          return camelcase(this.name().replace(/^no-/, ""));
        }
        return camelcase(this.name());
      }
      /**
       * Set the help group heading.
       *
       * @param {string} heading
       * @return {Option}
       */
      helpGroup(heading) {
        this.helpGroupHeading = heading;
        return this;
      }
      /**
       * Check if `arg` matches the short or long flag.
       *
       * @param {string} arg
       * @return {boolean}
       * @package
       */
      is(arg) {
        return this.short === arg || this.long === arg;
      }
      /**
       * Return whether a boolean option.
       *
       * Options are one of boolean, negated, required argument, or optional argument.
       *
       * @return {boolean}
       * @package
       */
      isBoolean() {
        return !this.required && !this.optional && !this.negate;
      }
    };
    var DualOptions = class {
      /**
       * @param {Option[]} options
       */
      constructor(options) {
        this.positiveOptions = /* @__PURE__ */ new Map();
        this.negativeOptions = /* @__PURE__ */ new Map();
        this.dualOptions = /* @__PURE__ */ new Set();
        options.forEach((option) => {
          if (option.negate) {
            this.negativeOptions.set(option.attributeName(), option);
          } else {
            this.positiveOptions.set(option.attributeName(), option);
          }
        });
        this.negativeOptions.forEach((value, key) => {
          if (this.positiveOptions.has(key)) {
            this.dualOptions.add(key);
          }
        });
      }
      /**
       * Did the value come from the option, and not from possible matching dual option?
       *
       * @param {*} value
       * @param {Option} option
       * @returns {boolean}
       */
      valueFromOption(value, option) {
        const optionKey = option.attributeName();
        if (!this.dualOptions.has(optionKey)) return true;
        const preset = this.negativeOptions.get(optionKey).presetArg;
        const negativeValue = preset !== void 0 ? preset : false;
        return option.negate === (negativeValue === value);
      }
    };
    function camelcase(str) {
      return str.split("-").reduce((str2, word) => {
        return str2 + word[0].toUpperCase() + word.slice(1);
      });
    }
    function splitOptionFlags(flags) {
      let shortFlag;
      let longFlag;
      const shortFlagExp = /^-[^-]$/;
      const longFlagExp = /^--[^-]/;
      const flagParts = flags.split(/[ |,]+/).concat("guard");
      if (shortFlagExp.test(flagParts[0])) shortFlag = flagParts.shift();
      if (longFlagExp.test(flagParts[0])) longFlag = flagParts.shift();
      if (!shortFlag && shortFlagExp.test(flagParts[0]))
        shortFlag = flagParts.shift();
      if (!shortFlag && longFlagExp.test(flagParts[0])) {
        shortFlag = longFlag;
        longFlag = flagParts.shift();
      }
      if (flagParts[0].startsWith("-")) {
        const unsupportedFlag = flagParts[0];
        const baseError = `option creation failed due to '${unsupportedFlag}' in option flags '${flags}'`;
        if (/^-[^-][^-]/.test(unsupportedFlag))
          throw new Error(
            `${baseError}
- a short flag is a single dash and a single character
  - either use a single dash and a single character (for a short flag)
  - or use a double dash for a long option (and can have two, like '--ws, --workspace')`
          );
        if (shortFlagExp.test(unsupportedFlag))
          throw new Error(`${baseError}
- too many short flags`);
        if (longFlagExp.test(unsupportedFlag))
          throw new Error(`${baseError}
- too many long flags`);
        throw new Error(`${baseError}
- unrecognised flag format`);
      }
      if (shortFlag === void 0 && longFlag === void 0)
        throw new Error(
          `option creation failed due to no flags found in '${flags}'.`
        );
      return { shortFlag, longFlag };
    }
    exports.Option = Option2;
    exports.DualOptions = DualOptions;
  }
});

// node_modules/commander/lib/suggestSimilar.js
var require_suggestSimilar = __commonJS({
  "node_modules/commander/lib/suggestSimilar.js"(exports) {
    "use strict";
    var maxDistance = 3;
    function editDistance(a, b) {
      if (Math.abs(a.length - b.length) > maxDistance)
        return Math.max(a.length, b.length);
      const d2 = [];
      for (let i = 0; i <= a.length; i++) {
        d2[i] = [i];
      }
      for (let j2 = 0; j2 <= b.length; j2++) {
        d2[0][j2] = j2;
      }
      for (let j2 = 1; j2 <= b.length; j2++) {
        for (let i = 1; i <= a.length; i++) {
          let cost = 1;
          if (a[i - 1] === b[j2 - 1]) {
            cost = 0;
          } else {
            cost = 1;
          }
          d2[i][j2] = Math.min(
            d2[i - 1][j2] + 1,
            // deletion
            d2[i][j2 - 1] + 1,
            // insertion
            d2[i - 1][j2 - 1] + cost
            // substitution
          );
          if (i > 1 && j2 > 1 && a[i - 1] === b[j2 - 2] && a[i - 2] === b[j2 - 1]) {
            d2[i][j2] = Math.min(d2[i][j2], d2[i - 2][j2 - 2] + 1);
          }
        }
      }
      return d2[a.length][b.length];
    }
    function suggestSimilar(word, candidates) {
      if (!candidates || candidates.length === 0) return "";
      candidates = Array.from(new Set(candidates));
      const searchingOptions = word.startsWith("--");
      if (searchingOptions) {
        word = word.slice(2);
        candidates = candidates.map((candidate) => candidate.slice(2));
      }
      let similar = [];
      let bestDistance = maxDistance;
      const minSimilarity = 0.4;
      candidates.forEach((candidate) => {
        if (candidate.length <= 1) return;
        const distance = editDistance(word, candidate);
        const length = Math.max(word.length, candidate.length);
        const similarity = (length - distance) / length;
        if (similarity > minSimilarity) {
          if (distance < bestDistance) {
            bestDistance = distance;
            similar = [candidate];
          } else if (distance === bestDistance) {
            similar.push(candidate);
          }
        }
      });
      similar.sort((a, b) => a.localeCompare(b));
      if (searchingOptions) {
        similar = similar.map((candidate) => `--${candidate}`);
      }
      if (similar.length > 1) {
        return `
(Did you mean one of ${similar.join(", ")}?)`;
      }
      if (similar.length === 1) {
        return `
(Did you mean ${similar[0]}?)`;
      }
      return "";
    }
    exports.suggestSimilar = suggestSimilar;
  }
});

// node_modules/commander/lib/command.js
var require_command = __commonJS({
  "node_modules/commander/lib/command.js"(exports) {
    "use strict";
    var EventEmitter = __require("events").EventEmitter;
    var childProcess = __require("child_process");
    var path8 = __require("path");
    var fs8 = __require("fs");
    var process2 = __require("process");
    var { Argument: Argument2, humanReadableArgName } = require_argument();
    var { CommanderError: CommanderError2 } = require_error();
    var { Help: Help2, stripColor } = require_help();
    var { Option: Option2, DualOptions } = require_option();
    var { suggestSimilar } = require_suggestSimilar();
    var Command2 = class _Command extends EventEmitter {
      /**
       * Initialize a new `Command`.
       *
       * @param {string} [name]
       */
      constructor(name) {
        super();
        this.commands = [];
        this.options = [];
        this.parent = null;
        this._allowUnknownOption = false;
        this._allowExcessArguments = false;
        this.registeredArguments = [];
        this._args = this.registeredArguments;
        this.args = [];
        this.rawArgs = [];
        this.processedArgs = [];
        this._scriptPath = null;
        this._name = name || "";
        this._optionValues = {};
        this._optionValueSources = {};
        this._storeOptionsAsProperties = false;
        this._actionHandler = null;
        this._executableHandler = false;
        this._executableFile = null;
        this._executableDir = null;
        this._defaultCommandName = null;
        this._exitCallback = null;
        this._aliases = [];
        this._combineFlagAndOptionalValue = true;
        this._description = "";
        this._summary = "";
        this._argsDescription = void 0;
        this._enablePositionalOptions = false;
        this._passThroughOptions = false;
        this._lifeCycleHooks = {};
        this._showHelpAfterError = false;
        this._showSuggestionAfterError = true;
        this._savedState = null;
        this._outputConfiguration = {
          writeOut: (str) => process2.stdout.write(str),
          writeErr: (str) => process2.stderr.write(str),
          outputError: (str, write) => write(str),
          getOutHelpWidth: () => process2.stdout.isTTY ? process2.stdout.columns : void 0,
          getErrHelpWidth: () => process2.stderr.isTTY ? process2.stderr.columns : void 0,
          getOutHasColors: () => useColor() ?? (process2.stdout.isTTY && process2.stdout.hasColors?.()),
          getErrHasColors: () => useColor() ?? (process2.stderr.isTTY && process2.stderr.hasColors?.()),
          stripColor: (str) => stripColor(str)
        };
        this._hidden = false;
        this._helpOption = void 0;
        this._addImplicitHelpCommand = void 0;
        this._helpCommand = void 0;
        this._helpConfiguration = {};
        this._helpGroupHeading = void 0;
        this._defaultCommandGroup = void 0;
        this._defaultOptionGroup = void 0;
      }
      /**
       * Copy settings that are useful to have in common across root command and subcommands.
       *
       * (Used internally when adding a command using `.command()` so subcommands inherit parent settings.)
       *
       * @param {Command} sourceCommand
       * @return {Command} `this` command for chaining
       */
      copyInheritedSettings(sourceCommand) {
        this._outputConfiguration = sourceCommand._outputConfiguration;
        this._helpOption = sourceCommand._helpOption;
        this._helpCommand = sourceCommand._helpCommand;
        this._helpConfiguration = sourceCommand._helpConfiguration;
        this._exitCallback = sourceCommand._exitCallback;
        this._storeOptionsAsProperties = sourceCommand._storeOptionsAsProperties;
        this._combineFlagAndOptionalValue = sourceCommand._combineFlagAndOptionalValue;
        this._allowExcessArguments = sourceCommand._allowExcessArguments;
        this._enablePositionalOptions = sourceCommand._enablePositionalOptions;
        this._showHelpAfterError = sourceCommand._showHelpAfterError;
        this._showSuggestionAfterError = sourceCommand._showSuggestionAfterError;
        return this;
      }
      /**
       * @returns {Command[]}
       * @private
       */
      _getCommandAndAncestors() {
        const result = [];
        for (let command = this; command; command = command.parent) {
          result.push(command);
        }
        return result;
      }
      /**
       * Define a command.
       *
       * There are two styles of command: pay attention to where to put the description.
       *
       * @example
       * // Command implemented using action handler (description is supplied separately to `.command`)
       * program
       *   .command('clone <source> [destination]')
       *   .description('clone a repository into a newly created directory')
       *   .action((source, destination) => {
       *     console.log('clone command called');
       *   });
       *
       * // Command implemented using separate executable file (description is second parameter to `.command`)
       * program
       *   .command('start <service>', 'start named service')
       *   .command('stop [service]', 'stop named service, or all if no name supplied');
       *
       * @param {string} nameAndArgs - command name and arguments, args are `<required>` or `[optional]` and last may also be `variadic...`
       * @param {(object | string)} [actionOptsOrExecDesc] - configuration options (for action), or description (for executable)
       * @param {object} [execOpts] - configuration options (for executable)
       * @return {Command} returns new command for action handler, or `this` for executable command
       */
      command(nameAndArgs, actionOptsOrExecDesc, execOpts) {
        let desc = actionOptsOrExecDesc;
        let opts = execOpts;
        if (typeof desc === "object" && desc !== null) {
          opts = desc;
          desc = null;
        }
        opts = opts || {};
        const [, name, args] = nameAndArgs.match(/([^ ]+) *(.*)/);
        const cmd = this.createCommand(name);
        if (desc) {
          cmd.description(desc);
          cmd._executableHandler = true;
        }
        if (opts.isDefault) this._defaultCommandName = cmd._name;
        cmd._hidden = !!(opts.noHelp || opts.hidden);
        cmd._executableFile = opts.executableFile || null;
        if (args) cmd.arguments(args);
        this._registerCommand(cmd);
        cmd.parent = this;
        cmd.copyInheritedSettings(this);
        if (desc) return this;
        return cmd;
      }
      /**
       * Factory routine to create a new unattached command.
       *
       * See .command() for creating an attached subcommand, which uses this routine to
       * create the command. You can override createCommand to customise subcommands.
       *
       * @param {string} [name]
       * @return {Command} new command
       */
      createCommand(name) {
        return new _Command(name);
      }
      /**
       * You can customise the help with a subclass of Help by overriding createHelp,
       * or by overriding Help properties using configureHelp().
       *
       * @return {Help}
       */
      createHelp() {
        return Object.assign(new Help2(), this.configureHelp());
      }
      /**
       * You can customise the help by overriding Help properties using configureHelp(),
       * or with a subclass of Help by overriding createHelp().
       *
       * @param {object} [configuration] - configuration options
       * @return {(Command | object)} `this` command for chaining, or stored configuration
       */
      configureHelp(configuration) {
        if (configuration === void 0) return this._helpConfiguration;
        this._helpConfiguration = configuration;
        return this;
      }
      /**
       * The default output goes to stdout and stderr. You can customise this for special
       * applications. You can also customise the display of errors by overriding outputError.
       *
       * The configuration properties are all functions:
       *
       *     // change how output being written, defaults to stdout and stderr
       *     writeOut(str)
       *     writeErr(str)
       *     // change how output being written for errors, defaults to writeErr
       *     outputError(str, write) // used for displaying errors and not used for displaying help
       *     // specify width for wrapping help
       *     getOutHelpWidth()
       *     getErrHelpWidth()
       *     // color support, currently only used with Help
       *     getOutHasColors()
       *     getErrHasColors()
       *     stripColor() // used to remove ANSI escape codes if output does not have colors
       *
       * @param {object} [configuration] - configuration options
       * @return {(Command | object)} `this` command for chaining, or stored configuration
       */
      configureOutput(configuration) {
        if (configuration === void 0) return this._outputConfiguration;
        this._outputConfiguration = {
          ...this._outputConfiguration,
          ...configuration
        };
        return this;
      }
      /**
       * Display the help or a custom message after an error occurs.
       *
       * @param {(boolean|string)} [displayHelp]
       * @return {Command} `this` command for chaining
       */
      showHelpAfterError(displayHelp = true) {
        if (typeof displayHelp !== "string") displayHelp = !!displayHelp;
        this._showHelpAfterError = displayHelp;
        return this;
      }
      /**
       * Display suggestion of similar commands for unknown commands, or options for unknown options.
       *
       * @param {boolean} [displaySuggestion]
       * @return {Command} `this` command for chaining
       */
      showSuggestionAfterError(displaySuggestion = true) {
        this._showSuggestionAfterError = !!displaySuggestion;
        return this;
      }
      /**
       * Add a prepared subcommand.
       *
       * See .command() for creating an attached subcommand which inherits settings from its parent.
       *
       * @param {Command} cmd - new subcommand
       * @param {object} [opts] - configuration options
       * @return {Command} `this` command for chaining
       */
      addCommand(cmd, opts) {
        if (!cmd._name) {
          throw new Error(`Command passed to .addCommand() must have a name
- specify the name in Command constructor or using .name()`);
        }
        opts = opts || {};
        if (opts.isDefault) this._defaultCommandName = cmd._name;
        if (opts.noHelp || opts.hidden) cmd._hidden = true;
        this._registerCommand(cmd);
        cmd.parent = this;
        cmd._checkForBrokenPassThrough();
        return this;
      }
      /**
       * Factory routine to create a new unattached argument.
       *
       * See .argument() for creating an attached argument, which uses this routine to
       * create the argument. You can override createArgument to return a custom argument.
       *
       * @param {string} name
       * @param {string} [description]
       * @return {Argument} new argument
       */
      createArgument(name, description) {
        return new Argument2(name, description);
      }
      /**
       * Define argument syntax for command.
       *
       * The default is that the argument is required, and you can explicitly
       * indicate this with <> around the name. Put [] around the name for an optional argument.
       *
       * @example
       * program.argument('<input-file>');
       * program.argument('[output-file]');
       *
       * @param {string} name
       * @param {string} [description]
       * @param {(Function|*)} [parseArg] - custom argument processing function or default value
       * @param {*} [defaultValue]
       * @return {Command} `this` command for chaining
       */
      argument(name, description, parseArg, defaultValue) {
        const argument = this.createArgument(name, description);
        if (typeof parseArg === "function") {
          argument.default(defaultValue).argParser(parseArg);
        } else {
          argument.default(parseArg);
        }
        this.addArgument(argument);
        return this;
      }
      /**
       * Define argument syntax for command, adding multiple at once (without descriptions).
       *
       * See also .argument().
       *
       * @example
       * program.arguments('<cmd> [env]');
       *
       * @param {string} names
       * @return {Command} `this` command for chaining
       */
      arguments(names) {
        names.trim().split(/ +/).forEach((detail) => {
          this.argument(detail);
        });
        return this;
      }
      /**
       * Define argument syntax for command, adding a prepared argument.
       *
       * @param {Argument} argument
       * @return {Command} `this` command for chaining
       */
      addArgument(argument) {
        const previousArgument = this.registeredArguments.slice(-1)[0];
        if (previousArgument?.variadic) {
          throw new Error(
            `only the last argument can be variadic '${previousArgument.name()}'`
          );
        }
        if (argument.required && argument.defaultValue !== void 0 && argument.parseArg === void 0) {
          throw new Error(
            `a default value for a required argument is never used: '${argument.name()}'`
          );
        }
        this.registeredArguments.push(argument);
        return this;
      }
      /**
       * Customise or override default help command. By default a help command is automatically added if your command has subcommands.
       *
       * @example
       *    program.helpCommand('help [cmd]');
       *    program.helpCommand('help [cmd]', 'show help');
       *    program.helpCommand(false); // suppress default help command
       *    program.helpCommand(true); // add help command even if no subcommands
       *
       * @param {string|boolean} enableOrNameAndArgs - enable with custom name and/or arguments, or boolean to override whether added
       * @param {string} [description] - custom description
       * @return {Command} `this` command for chaining
       */
      helpCommand(enableOrNameAndArgs, description) {
        if (typeof enableOrNameAndArgs === "boolean") {
          this._addImplicitHelpCommand = enableOrNameAndArgs;
          if (enableOrNameAndArgs && this._defaultCommandGroup) {
            this._initCommandGroup(this._getHelpCommand());
          }
          return this;
        }
        const nameAndArgs = enableOrNameAndArgs ?? "help [command]";
        const [, helpName, helpArgs] = nameAndArgs.match(/([^ ]+) *(.*)/);
        const helpDescription = description ?? "display help for command";
        const helpCommand = this.createCommand(helpName);
        helpCommand.helpOption(false);
        if (helpArgs) helpCommand.arguments(helpArgs);
        if (helpDescription) helpCommand.description(helpDescription);
        this._addImplicitHelpCommand = true;
        this._helpCommand = helpCommand;
        if (enableOrNameAndArgs || description) this._initCommandGroup(helpCommand);
        return this;
      }
      /**
       * Add prepared custom help command.
       *
       * @param {(Command|string|boolean)} helpCommand - custom help command, or deprecated enableOrNameAndArgs as for `.helpCommand()`
       * @param {string} [deprecatedDescription] - deprecated custom description used with custom name only
       * @return {Command} `this` command for chaining
       */
      addHelpCommand(helpCommand, deprecatedDescription) {
        if (typeof helpCommand !== "object") {
          this.helpCommand(helpCommand, deprecatedDescription);
          return this;
        }
        this._addImplicitHelpCommand = true;
        this._helpCommand = helpCommand;
        this._initCommandGroup(helpCommand);
        return this;
      }
      /**
       * Lazy create help command.
       *
       * @return {(Command|null)}
       * @package
       */
      _getHelpCommand() {
        const hasImplicitHelpCommand = this._addImplicitHelpCommand ?? (this.commands.length && !this._actionHandler && !this._findCommand("help"));
        if (hasImplicitHelpCommand) {
          if (this._helpCommand === void 0) {
            this.helpCommand(void 0, void 0);
          }
          return this._helpCommand;
        }
        return null;
      }
      /**
       * Add hook for life cycle event.
       *
       * @param {string} event
       * @param {Function} listener
       * @return {Command} `this` command for chaining
       */
      hook(event, listener) {
        const allowedValues = ["preSubcommand", "preAction", "postAction"];
        if (!allowedValues.includes(event)) {
          throw new Error(`Unexpected value for event passed to hook : '${event}'.
Expecting one of '${allowedValues.join("', '")}'`);
        }
        if (this._lifeCycleHooks[event]) {
          this._lifeCycleHooks[event].push(listener);
        } else {
          this._lifeCycleHooks[event] = [listener];
        }
        return this;
      }
      /**
       * Register callback to use as replacement for calling process.exit.
       *
       * @param {Function} [fn] optional callback which will be passed a CommanderError, defaults to throwing
       * @return {Command} `this` command for chaining
       */
      exitOverride(fn) {
        if (fn) {
          this._exitCallback = fn;
        } else {
          this._exitCallback = (err) => {
            if (err.code !== "commander.executeSubCommandAsync") {
              throw err;
            } else {
            }
          };
        }
        return this;
      }
      /**
       * Call process.exit, and _exitCallback if defined.
       *
       * @param {number} exitCode exit code for using with process.exit
       * @param {string} code an id string representing the error
       * @param {string} message human-readable description of the error
       * @return never
       * @private
       */
      _exit(exitCode, code, message) {
        if (this._exitCallback) {
          this._exitCallback(new CommanderError2(exitCode, code, message));
        }
        process2.exit(exitCode);
      }
      /**
       * Register callback `fn` for the command.
       *
       * @example
       * program
       *   .command('serve')
       *   .description('start service')
       *   .action(function() {
       *      // do work here
       *   });
       *
       * @param {Function} fn
       * @return {Command} `this` command for chaining
       */
      action(fn) {
        const listener = (args) => {
          const expectedArgsCount = this.registeredArguments.length;
          const actionArgs = args.slice(0, expectedArgsCount);
          if (this._storeOptionsAsProperties) {
            actionArgs[expectedArgsCount] = this;
          } else {
            actionArgs[expectedArgsCount] = this.opts();
          }
          actionArgs.push(this);
          return fn.apply(this, actionArgs);
        };
        this._actionHandler = listener;
        return this;
      }
      /**
       * Factory routine to create a new unattached option.
       *
       * See .option() for creating an attached option, which uses this routine to
       * create the option. You can override createOption to return a custom option.
       *
       * @param {string} flags
       * @param {string} [description]
       * @return {Option} new option
       */
      createOption(flags, description) {
        return new Option2(flags, description);
      }
      /**
       * Wrap parseArgs to catch 'commander.invalidArgument'.
       *
       * @param {(Option | Argument)} target
       * @param {string} value
       * @param {*} previous
       * @param {string} invalidArgumentMessage
       * @private
       */
      _callParseArg(target, value, previous, invalidArgumentMessage) {
        try {
          return target.parseArg(value, previous);
        } catch (err) {
          if (err.code === "commander.invalidArgument") {
            const message = `${invalidArgumentMessage} ${err.message}`;
            this.error(message, { exitCode: err.exitCode, code: err.code });
          }
          throw err;
        }
      }
      /**
       * Check for option flag conflicts.
       * Register option if no conflicts found, or throw on conflict.
       *
       * @param {Option} option
       * @private
       */
      _registerOption(option) {
        const matchingOption = option.short && this._findOption(option.short) || option.long && this._findOption(option.long);
        if (matchingOption) {
          const matchingFlag = option.long && this._findOption(option.long) ? option.long : option.short;
          throw new Error(`Cannot add option '${option.flags}'${this._name && ` to command '${this._name}'`} due to conflicting flag '${matchingFlag}'
-  already used by option '${matchingOption.flags}'`);
        }
        this._initOptionGroup(option);
        this.options.push(option);
      }
      /**
       * Check for command name and alias conflicts with existing commands.
       * Register command if no conflicts found, or throw on conflict.
       *
       * @param {Command} command
       * @private
       */
      _registerCommand(command) {
        const knownBy = (cmd) => {
          return [cmd.name()].concat(cmd.aliases());
        };
        const alreadyUsed = knownBy(command).find(
          (name) => this._findCommand(name)
        );
        if (alreadyUsed) {
          const existingCmd = knownBy(this._findCommand(alreadyUsed)).join("|");
          const newCmd = knownBy(command).join("|");
          throw new Error(
            `cannot add command '${newCmd}' as already have command '${existingCmd}'`
          );
        }
        this._initCommandGroup(command);
        this.commands.push(command);
      }
      /**
       * Add an option.
       *
       * @param {Option} option
       * @return {Command} `this` command for chaining
       */
      addOption(option) {
        this._registerOption(option);
        const oname = option.name();
        const name = option.attributeName();
        if (option.negate) {
          const positiveLongFlag = option.long.replace(/^--no-/, "--");
          if (!this._findOption(positiveLongFlag)) {
            this.setOptionValueWithSource(
              name,
              option.defaultValue === void 0 ? true : option.defaultValue,
              "default"
            );
          }
        } else if (option.defaultValue !== void 0) {
          this.setOptionValueWithSource(name, option.defaultValue, "default");
        }
        const handleOptionValue = (val, invalidValueMessage, valueSource) => {
          if (val == null && option.presetArg !== void 0) {
            val = option.presetArg;
          }
          const oldValue = this.getOptionValue(name);
          if (val !== null && option.parseArg) {
            val = this._callParseArg(option, val, oldValue, invalidValueMessage);
          } else if (val !== null && option.variadic) {
            val = option._collectValue(val, oldValue);
          }
          if (val == null) {
            if (option.negate) {
              val = false;
            } else if (option.isBoolean() || option.optional) {
              val = true;
            } else {
              val = "";
            }
          }
          this.setOptionValueWithSource(name, val, valueSource);
        };
        this.on("option:" + oname, (val) => {
          const invalidValueMessage = `error: option '${option.flags}' argument '${val}' is invalid.`;
          handleOptionValue(val, invalidValueMessage, "cli");
        });
        if (option.envVar) {
          this.on("optionEnv:" + oname, (val) => {
            const invalidValueMessage = `error: option '${option.flags}' value '${val}' from env '${option.envVar}' is invalid.`;
            handleOptionValue(val, invalidValueMessage, "env");
          });
        }
        return this;
      }
      /**
       * Internal implementation shared by .option() and .requiredOption()
       *
       * @return {Command} `this` command for chaining
       * @private
       */
      _optionEx(config, flags, description, fn, defaultValue) {
        if (typeof flags === "object" && flags instanceof Option2) {
          throw new Error(
            "To add an Option object use addOption() instead of option() or requiredOption()"
          );
        }
        const option = this.createOption(flags, description);
        option.makeOptionMandatory(!!config.mandatory);
        if (typeof fn === "function") {
          option.default(defaultValue).argParser(fn);
        } else if (fn instanceof RegExp) {
          const regex = fn;
          fn = (val, def) => {
            const m = regex.exec(val);
            return m ? m[0] : def;
          };
          option.default(defaultValue).argParser(fn);
        } else {
          option.default(fn);
        }
        return this.addOption(option);
      }
      /**
       * Define option with `flags`, `description`, and optional argument parsing function or `defaultValue` or both.
       *
       * The `flags` string contains the short and/or long flags, separated by comma, a pipe or space. A required
       * option-argument is indicated by `<>` and an optional option-argument by `[]`.
       *
       * See the README for more details, and see also addOption() and requiredOption().
       *
       * @example
       * program
       *     .option('-p, --pepper', 'add pepper')
       *     .option('--pt, --pizza-type <TYPE>', 'type of pizza') // required option-argument
       *     .option('-c, --cheese [CHEESE]', 'add extra cheese', 'mozzarella') // optional option-argument with default
       *     .option('-t, --tip <VALUE>', 'add tip to purchase cost', parseFloat) // custom parse function
       *
       * @param {string} flags
       * @param {string} [description]
       * @param {(Function|*)} [parseArg] - custom option processing function or default value
       * @param {*} [defaultValue]
       * @return {Command} `this` command for chaining
       */
      option(flags, description, parseArg, defaultValue) {
        return this._optionEx({}, flags, description, parseArg, defaultValue);
      }
      /**
       * Add a required option which must have a value after parsing. This usually means
       * the option must be specified on the command line. (Otherwise the same as .option().)
       *
       * The `flags` string contains the short and/or long flags, separated by comma, a pipe or space.
       *
       * @param {string} flags
       * @param {string} [description]
       * @param {(Function|*)} [parseArg] - custom option processing function or default value
       * @param {*} [defaultValue]
       * @return {Command} `this` command for chaining
       */
      requiredOption(flags, description, parseArg, defaultValue) {
        return this._optionEx(
          { mandatory: true },
          flags,
          description,
          parseArg,
          defaultValue
        );
      }
      /**
       * Alter parsing of short flags with optional values.
       *
       * @example
       * // for `.option('-f,--flag [value]'):
       * program.combineFlagAndOptionalValue(true);  // `-f80` is treated like `--flag=80`, this is the default behaviour
       * program.combineFlagAndOptionalValue(false) // `-fb` is treated like `-f -b`
       *
       * @param {boolean} [combine] - if `true` or omitted, an optional value can be specified directly after the flag.
       * @return {Command} `this` command for chaining
       */
      combineFlagAndOptionalValue(combine = true) {
        this._combineFlagAndOptionalValue = !!combine;
        return this;
      }
      /**
       * Allow unknown options on the command line.
       *
       * @param {boolean} [allowUnknown] - if `true` or omitted, no error will be thrown for unknown options.
       * @return {Command} `this` command for chaining
       */
      allowUnknownOption(allowUnknown = true) {
        this._allowUnknownOption = !!allowUnknown;
        return this;
      }
      /**
       * Allow excess command-arguments on the command line. Pass false to make excess arguments an error.
       *
       * @param {boolean} [allowExcess] - if `true` or omitted, no error will be thrown for excess arguments.
       * @return {Command} `this` command for chaining
       */
      allowExcessArguments(allowExcess = true) {
        this._allowExcessArguments = !!allowExcess;
        return this;
      }
      /**
       * Enable positional options. Positional means global options are specified before subcommands which lets
       * subcommands reuse the same option names, and also enables subcommands to turn on passThroughOptions.
       * The default behaviour is non-positional and global options may appear anywhere on the command line.
       *
       * @param {boolean} [positional]
       * @return {Command} `this` command for chaining
       */
      enablePositionalOptions(positional = true) {
        this._enablePositionalOptions = !!positional;
        return this;
      }
      /**
       * Pass through options that come after command-arguments rather than treat them as command-options,
       * so actual command-options come before command-arguments. Turning this on for a subcommand requires
       * positional options to have been enabled on the program (parent commands).
       * The default behaviour is non-positional and options may appear before or after command-arguments.
       *
       * @param {boolean} [passThrough] for unknown options.
       * @return {Command} `this` command for chaining
       */
      passThroughOptions(passThrough = true) {
        this._passThroughOptions = !!passThrough;
        this._checkForBrokenPassThrough();
        return this;
      }
      /**
       * @private
       */
      _checkForBrokenPassThrough() {
        if (this.parent && this._passThroughOptions && !this.parent._enablePositionalOptions) {
          throw new Error(
            `passThroughOptions cannot be used for '${this._name}' without turning on enablePositionalOptions for parent command(s)`
          );
        }
      }
      /**
       * Whether to store option values as properties on command object,
       * or store separately (specify false). In both cases the option values can be accessed using .opts().
       *
       * @param {boolean} [storeAsProperties=true]
       * @return {Command} `this` command for chaining
       */
      storeOptionsAsProperties(storeAsProperties = true) {
        if (this.options.length) {
          throw new Error("call .storeOptionsAsProperties() before adding options");
        }
        if (Object.keys(this._optionValues).length) {
          throw new Error(
            "call .storeOptionsAsProperties() before setting option values"
          );
        }
        this._storeOptionsAsProperties = !!storeAsProperties;
        return this;
      }
      /**
       * Retrieve option value.
       *
       * @param {string} key
       * @return {object} value
       */
      getOptionValue(key) {
        if (this._storeOptionsAsProperties) {
          return this[key];
        }
        return this._optionValues[key];
      }
      /**
       * Store option value.
       *
       * @param {string} key
       * @param {object} value
       * @return {Command} `this` command for chaining
       */
      setOptionValue(key, value) {
        return this.setOptionValueWithSource(key, value, void 0);
      }
      /**
       * Store option value and where the value came from.
       *
       * @param {string} key
       * @param {object} value
       * @param {string} source - expected values are default/config/env/cli/implied
       * @return {Command} `this` command for chaining
       */
      setOptionValueWithSource(key, value, source) {
        if (this._storeOptionsAsProperties) {
          this[key] = value;
        } else {
          this._optionValues[key] = value;
        }
        this._optionValueSources[key] = source;
        return this;
      }
      /**
       * Get source of option value.
       * Expected values are default | config | env | cli | implied
       *
       * @param {string} key
       * @return {string}
       */
      getOptionValueSource(key) {
        return this._optionValueSources[key];
      }
      /**
       * Get source of option value. See also .optsWithGlobals().
       * Expected values are default | config | env | cli | implied
       *
       * @param {string} key
       * @return {string}
       */
      getOptionValueSourceWithGlobals(key) {
        let source;
        this._getCommandAndAncestors().forEach((cmd) => {
          if (cmd.getOptionValueSource(key) !== void 0) {
            source = cmd.getOptionValueSource(key);
          }
        });
        return source;
      }
      /**
       * Get user arguments from implied or explicit arguments.
       * Side-effects: set _scriptPath if args included script. Used for default program name, and subcommand searches.
       *
       * @private
       */
      _prepareUserArgs(argv, parseOptions) {
        if (argv !== void 0 && !Array.isArray(argv)) {
          throw new Error("first parameter to parse must be array or undefined");
        }
        parseOptions = parseOptions || {};
        if (argv === void 0 && parseOptions.from === void 0) {
          if (process2.versions?.electron) {
            parseOptions.from = "electron";
          }
          const execArgv = process2.execArgv ?? [];
          if (execArgv.includes("-e") || execArgv.includes("--eval") || execArgv.includes("-p") || execArgv.includes("--print")) {
            parseOptions.from = "eval";
          }
        }
        if (argv === void 0) {
          argv = process2.argv;
        }
        this.rawArgs = argv.slice();
        let userArgs;
        switch (parseOptions.from) {
          case void 0:
          case "node":
            this._scriptPath = argv[1];
            userArgs = argv.slice(2);
            break;
          case "electron":
            if (process2.defaultApp) {
              this._scriptPath = argv[1];
              userArgs = argv.slice(2);
            } else {
              userArgs = argv.slice(1);
            }
            break;
          case "user":
            userArgs = argv.slice(0);
            break;
          case "eval":
            userArgs = argv.slice(1);
            break;
          default:
            throw new Error(
              `unexpected parse option { from: '${parseOptions.from}' }`
            );
        }
        if (!this._name && this._scriptPath)
          this.nameFromFilename(this._scriptPath);
        this._name = this._name || "program";
        return userArgs;
      }
      /**
       * Parse `argv`, setting options and invoking commands when defined.
       *
       * Use parseAsync instead of parse if any of your action handlers are async.
       *
       * Call with no parameters to parse `process.argv`. Detects Electron and special node options like `node --eval`. Easy mode!
       *
       * Or call with an array of strings to parse, and optionally where the user arguments start by specifying where the arguments are `from`:
       * - `'node'`: default, `argv[0]` is the application and `argv[1]` is the script being run, with user arguments after that
       * - `'electron'`: `argv[0]` is the application and `argv[1]` varies depending on whether the electron application is packaged
       * - `'user'`: just user arguments
       *
       * @example
       * program.parse(); // parse process.argv and auto-detect electron and special node flags
       * program.parse(process.argv); // assume argv[0] is app and argv[1] is script
       * program.parse(my-args, { from: 'user' }); // just user supplied arguments, nothing special about argv[0]
       *
       * @param {string[]} [argv] - optional, defaults to process.argv
       * @param {object} [parseOptions] - optionally specify style of options with from: node/user/electron
       * @param {string} [parseOptions.from] - where the args are from: 'node', 'user', 'electron'
       * @return {Command} `this` command for chaining
       */
      parse(argv, parseOptions) {
        this._prepareForParse();
        const userArgs = this._prepareUserArgs(argv, parseOptions);
        this._parseCommand([], userArgs);
        return this;
      }
      /**
       * Parse `argv`, setting options and invoking commands when defined.
       *
       * Call with no parameters to parse `process.argv`. Detects Electron and special node options like `node --eval`. Easy mode!
       *
       * Or call with an array of strings to parse, and optionally where the user arguments start by specifying where the arguments are `from`:
       * - `'node'`: default, `argv[0]` is the application and `argv[1]` is the script being run, with user arguments after that
       * - `'electron'`: `argv[0]` is the application and `argv[1]` varies depending on whether the electron application is packaged
       * - `'user'`: just user arguments
       *
       * @example
       * await program.parseAsync(); // parse process.argv and auto-detect electron and special node flags
       * await program.parseAsync(process.argv); // assume argv[0] is app and argv[1] is script
       * await program.parseAsync(my-args, { from: 'user' }); // just user supplied arguments, nothing special about argv[0]
       *
       * @param {string[]} [argv]
       * @param {object} [parseOptions]
       * @param {string} parseOptions.from - where the args are from: 'node', 'user', 'electron'
       * @return {Promise}
       */
      async parseAsync(argv, parseOptions) {
        this._prepareForParse();
        const userArgs = this._prepareUserArgs(argv, parseOptions);
        await this._parseCommand([], userArgs);
        return this;
      }
      _prepareForParse() {
        if (this._savedState === null) {
          this.saveStateBeforeParse();
        } else {
          this.restoreStateBeforeParse();
        }
      }
      /**
       * Called the first time parse is called to save state and allow a restore before subsequent calls to parse.
       * Not usually called directly, but available for subclasses to save their custom state.
       *
       * This is called in a lazy way. Only commands used in parsing chain will have state saved.
       */
      saveStateBeforeParse() {
        this._savedState = {
          // name is stable if supplied by author, but may be unspecified for root command and deduced during parsing
          _name: this._name,
          // option values before parse have default values (including false for negated options)
          // shallow clones
          _optionValues: { ...this._optionValues },
          _optionValueSources: { ...this._optionValueSources }
        };
      }
      /**
       * Restore state before parse for calls after the first.
       * Not usually called directly, but available for subclasses to save their custom state.
       *
       * This is called in a lazy way. Only commands used in parsing chain will have state restored.
       */
      restoreStateBeforeParse() {
        if (this._storeOptionsAsProperties)
          throw new Error(`Can not call parse again when storeOptionsAsProperties is true.
- either make a new Command for each call to parse, or stop storing options as properties`);
        this._name = this._savedState._name;
        this._scriptPath = null;
        this.rawArgs = [];
        this._optionValues = { ...this._savedState._optionValues };
        this._optionValueSources = { ...this._savedState._optionValueSources };
        this.args = [];
        this.processedArgs = [];
      }
      /**
       * Throw if expected executable is missing. Add lots of help for author.
       *
       * @param {string} executableFile
       * @param {string} executableDir
       * @param {string} subcommandName
       */
      _checkForMissingExecutable(executableFile, executableDir, subcommandName) {
        if (fs8.existsSync(executableFile)) return;
        const executableDirMessage = executableDir ? `searched for local subcommand relative to directory '${executableDir}'` : "no directory for search for local subcommand, use .executableDir() to supply a custom directory";
        const executableMissing = `'${executableFile}' does not exist
 - if '${subcommandName}' is not meant to be an executable command, remove description parameter from '.command()' and use '.description()' instead
 - if the default executable name is not suitable, use the executableFile option to supply a custom name or path
 - ${executableDirMessage}`;
        throw new Error(executableMissing);
      }
      /**
       * Execute a sub-command executable.
       *
       * @private
       */
      _executeSubCommand(subcommand, args) {
        args = args.slice();
        let launchWithNode = false;
        const sourceExt = [".js", ".ts", ".tsx", ".mjs", ".cjs"];
        function findFile(baseDir, baseName) {
          const localBin = path8.resolve(baseDir, baseName);
          if (fs8.existsSync(localBin)) return localBin;
          if (sourceExt.includes(path8.extname(baseName))) return void 0;
          const foundExt = sourceExt.find(
            (ext) => fs8.existsSync(`${localBin}${ext}`)
          );
          if (foundExt) return `${localBin}${foundExt}`;
          return void 0;
        }
        this._checkForMissingMandatoryOptions();
        this._checkForConflictingOptions();
        let executableFile = subcommand._executableFile || `${this._name}-${subcommand._name}`;
        let executableDir = this._executableDir || "";
        if (this._scriptPath) {
          let resolvedScriptPath;
          try {
            resolvedScriptPath = fs8.realpathSync(this._scriptPath);
          } catch {
            resolvedScriptPath = this._scriptPath;
          }
          executableDir = path8.resolve(
            path8.dirname(resolvedScriptPath),
            executableDir
          );
        }
        if (executableDir) {
          let localFile = findFile(executableDir, executableFile);
          if (!localFile && !subcommand._executableFile && this._scriptPath) {
            const legacyName = path8.basename(
              this._scriptPath,
              path8.extname(this._scriptPath)
            );
            if (legacyName !== this._name) {
              localFile = findFile(
                executableDir,
                `${legacyName}-${subcommand._name}`
              );
            }
          }
          executableFile = localFile || executableFile;
        }
        launchWithNode = sourceExt.includes(path8.extname(executableFile));
        let proc;
        if (process2.platform !== "win32") {
          if (launchWithNode) {
            args.unshift(executableFile);
            args = incrementNodeInspectorPort(process2.execArgv).concat(args);
            proc = childProcess.spawn(process2.argv[0], args, { stdio: "inherit" });
          } else {
            proc = childProcess.spawn(executableFile, args, { stdio: "inherit" });
          }
        } else {
          this._checkForMissingExecutable(
            executableFile,
            executableDir,
            subcommand._name
          );
          args.unshift(executableFile);
          args = incrementNodeInspectorPort(process2.execArgv).concat(args);
          proc = childProcess.spawn(process2.execPath, args, { stdio: "inherit" });
        }
        if (!proc.killed) {
          const signals = ["SIGUSR1", "SIGUSR2", "SIGTERM", "SIGINT", "SIGHUP"];
          signals.forEach((signal) => {
            process2.on(signal, () => {
              if (proc.killed === false && proc.exitCode === null) {
                proc.kill(signal);
              }
            });
          });
        }
        const exitCallback = this._exitCallback;
        proc.on("close", (code) => {
          code = code ?? 1;
          if (!exitCallback) {
            process2.exit(code);
          } else {
            exitCallback(
              new CommanderError2(
                code,
                "commander.executeSubCommandAsync",
                "(close)"
              )
            );
          }
        });
        proc.on("error", (err) => {
          if (err.code === "ENOENT") {
            this._checkForMissingExecutable(
              executableFile,
              executableDir,
              subcommand._name
            );
          } else if (err.code === "EACCES") {
            throw new Error(`'${executableFile}' not executable`);
          }
          if (!exitCallback) {
            process2.exit(1);
          } else {
            const wrappedError = new CommanderError2(
              1,
              "commander.executeSubCommandAsync",
              "(error)"
            );
            wrappedError.nestedError = err;
            exitCallback(wrappedError);
          }
        });
        this.runningCommand = proc;
      }
      /**
       * @private
       */
      _dispatchSubcommand(commandName, operands, unknown) {
        const subCommand = this._findCommand(commandName);
        if (!subCommand) this.help({ error: true });
        subCommand._prepareForParse();
        let promiseChain;
        promiseChain = this._chainOrCallSubCommandHook(
          promiseChain,
          subCommand,
          "preSubcommand"
        );
        promiseChain = this._chainOrCall(promiseChain, () => {
          if (subCommand._executableHandler) {
            this._executeSubCommand(subCommand, operands.concat(unknown));
          } else {
            return subCommand._parseCommand(operands, unknown);
          }
        });
        return promiseChain;
      }
      /**
       * Invoke help directly if possible, or dispatch if necessary.
       * e.g. help foo
       *
       * @private
       */
      _dispatchHelpCommand(subcommandName) {
        if (!subcommandName) {
          this.help();
        }
        const subCommand = this._findCommand(subcommandName);
        if (subCommand && !subCommand._executableHandler) {
          subCommand.help();
        }
        return this._dispatchSubcommand(
          subcommandName,
          [],
          [this._getHelpOption()?.long ?? this._getHelpOption()?.short ?? "--help"]
        );
      }
      /**
       * Check this.args against expected this.registeredArguments.
       *
       * @private
       */
      _checkNumberOfArguments() {
        this.registeredArguments.forEach((arg, i) => {
          if (arg.required && this.args[i] == null) {
            this.missingArgument(arg.name());
          }
        });
        if (this.registeredArguments.length > 0 && this.registeredArguments[this.registeredArguments.length - 1].variadic) {
          return;
        }
        if (this.args.length > this.registeredArguments.length) {
          this._excessArguments(this.args);
        }
      }
      /**
       * Process this.args using this.registeredArguments and save as this.processedArgs!
       *
       * @private
       */
      _processArguments() {
        const myParseArg = (argument, value, previous) => {
          let parsedValue = value;
          if (value !== null && argument.parseArg) {
            const invalidValueMessage = `error: command-argument value '${value}' is invalid for argument '${argument.name()}'.`;
            parsedValue = this._callParseArg(
              argument,
              value,
              previous,
              invalidValueMessage
            );
          }
          return parsedValue;
        };
        this._checkNumberOfArguments();
        const processedArgs = [];
        this.registeredArguments.forEach((declaredArg, index) => {
          let value = declaredArg.defaultValue;
          if (declaredArg.variadic) {
            if (index < this.args.length) {
              value = this.args.slice(index);
              if (declaredArg.parseArg) {
                value = value.reduce((processed, v) => {
                  return myParseArg(declaredArg, v, processed);
                }, declaredArg.defaultValue);
              }
            } else if (value === void 0) {
              value = [];
            }
          } else if (index < this.args.length) {
            value = this.args[index];
            if (declaredArg.parseArg) {
              value = myParseArg(declaredArg, value, declaredArg.defaultValue);
            }
          }
          processedArgs[index] = value;
        });
        this.processedArgs = processedArgs;
      }
      /**
       * Once we have a promise we chain, but call synchronously until then.
       *
       * @param {(Promise|undefined)} promise
       * @param {Function} fn
       * @return {(Promise|undefined)}
       * @private
       */
      _chainOrCall(promise, fn) {
        if (promise?.then && typeof promise.then === "function") {
          return promise.then(() => fn());
        }
        return fn();
      }
      /**
       *
       * @param {(Promise|undefined)} promise
       * @param {string} event
       * @return {(Promise|undefined)}
       * @private
       */
      _chainOrCallHooks(promise, event) {
        let result = promise;
        const hooks = [];
        this._getCommandAndAncestors().reverse().filter((cmd) => cmd._lifeCycleHooks[event] !== void 0).forEach((hookedCommand) => {
          hookedCommand._lifeCycleHooks[event].forEach((callback) => {
            hooks.push({ hookedCommand, callback });
          });
        });
        if (event === "postAction") {
          hooks.reverse();
        }
        hooks.forEach((hookDetail) => {
          result = this._chainOrCall(result, () => {
            return hookDetail.callback(hookDetail.hookedCommand, this);
          });
        });
        return result;
      }
      /**
       *
       * @param {(Promise|undefined)} promise
       * @param {Command} subCommand
       * @param {string} event
       * @return {(Promise|undefined)}
       * @private
       */
      _chainOrCallSubCommandHook(promise, subCommand, event) {
        let result = promise;
        if (this._lifeCycleHooks[event] !== void 0) {
          this._lifeCycleHooks[event].forEach((hook) => {
            result = this._chainOrCall(result, () => {
              return hook(this, subCommand);
            });
          });
        }
        return result;
      }
      /**
       * Process arguments in context of this command.
       * Returns action result, in case it is a promise.
       *
       * @private
       */
      _parseCommand(operands, unknown) {
        const parsed = this.parseOptions(unknown);
        this._parseOptionsEnv();
        this._parseOptionsImplied();
        operands = operands.concat(parsed.operands);
        unknown = parsed.unknown;
        this.args = operands.concat(unknown);
        if (operands && this._findCommand(operands[0])) {
          return this._dispatchSubcommand(operands[0], operands.slice(1), unknown);
        }
        if (this._getHelpCommand() && operands[0] === this._getHelpCommand().name()) {
          return this._dispatchHelpCommand(operands[1]);
        }
        if (this._defaultCommandName) {
          this._outputHelpIfRequested(unknown);
          return this._dispatchSubcommand(
            this._defaultCommandName,
            operands,
            unknown
          );
        }
        if (this.commands.length && this.args.length === 0 && !this._actionHandler && !this._defaultCommandName) {
          this.help({ error: true });
        }
        this._outputHelpIfRequested(parsed.unknown);
        this._checkForMissingMandatoryOptions();
        this._checkForConflictingOptions();
        const checkForUnknownOptions = () => {
          if (parsed.unknown.length > 0) {
            this.unknownOption(parsed.unknown[0]);
          }
        };
        const commandEvent = `command:${this.name()}`;
        if (this._actionHandler) {
          checkForUnknownOptions();
          this._processArguments();
          let promiseChain;
          promiseChain = this._chainOrCallHooks(promiseChain, "preAction");
          promiseChain = this._chainOrCall(
            promiseChain,
            () => this._actionHandler(this.processedArgs)
          );
          if (this.parent) {
            promiseChain = this._chainOrCall(promiseChain, () => {
              this.parent.emit(commandEvent, operands, unknown);
            });
          }
          promiseChain = this._chainOrCallHooks(promiseChain, "postAction");
          return promiseChain;
        }
        if (this.parent?.listenerCount(commandEvent)) {
          checkForUnknownOptions();
          this._processArguments();
          this.parent.emit(commandEvent, operands, unknown);
        } else if (operands.length) {
          if (this._findCommand("*")) {
            return this._dispatchSubcommand("*", operands, unknown);
          }
          if (this.listenerCount("command:*")) {
            this.emit("command:*", operands, unknown);
          } else if (this.commands.length) {
            this.unknownCommand();
          } else {
            checkForUnknownOptions();
            this._processArguments();
          }
        } else if (this.commands.length) {
          checkForUnknownOptions();
          this.help({ error: true });
        } else {
          checkForUnknownOptions();
          this._processArguments();
        }
      }
      /**
       * Find matching command.
       *
       * @private
       * @return {Command | undefined}
       */
      _findCommand(name) {
        if (!name) return void 0;
        return this.commands.find(
          (cmd) => cmd._name === name || cmd._aliases.includes(name)
        );
      }
      /**
       * Return an option matching `arg` if any.
       *
       * @param {string} arg
       * @return {Option}
       * @package
       */
      _findOption(arg) {
        return this.options.find((option) => option.is(arg));
      }
      /**
       * Display an error message if a mandatory option does not have a value.
       * Called after checking for help flags in leaf subcommand.
       *
       * @private
       */
      _checkForMissingMandatoryOptions() {
        this._getCommandAndAncestors().forEach((cmd) => {
          cmd.options.forEach((anOption) => {
            if (anOption.mandatory && cmd.getOptionValue(anOption.attributeName()) === void 0) {
              cmd.missingMandatoryOptionValue(anOption);
            }
          });
        });
      }
      /**
       * Display an error message if conflicting options are used together in this.
       *
       * @private
       */
      _checkForConflictingLocalOptions() {
        const definedNonDefaultOptions = this.options.filter((option) => {
          const optionKey = option.attributeName();
          if (this.getOptionValue(optionKey) === void 0) {
            return false;
          }
          return this.getOptionValueSource(optionKey) !== "default";
        });
        const optionsWithConflicting = definedNonDefaultOptions.filter(
          (option) => option.conflictsWith.length > 0
        );
        optionsWithConflicting.forEach((option) => {
          const conflictingAndDefined = definedNonDefaultOptions.find(
            (defined) => option.conflictsWith.includes(defined.attributeName())
          );
          if (conflictingAndDefined) {
            this._conflictingOption(option, conflictingAndDefined);
          }
        });
      }
      /**
       * Display an error message if conflicting options are used together.
       * Called after checking for help flags in leaf subcommand.
       *
       * @private
       */
      _checkForConflictingOptions() {
        this._getCommandAndAncestors().forEach((cmd) => {
          cmd._checkForConflictingLocalOptions();
        });
      }
      /**
       * Parse options from `argv` removing known options,
       * and return argv split into operands and unknown arguments.
       *
       * Side effects: modifies command by storing options. Does not reset state if called again.
       *
       * Examples:
       *
       *     argv => operands, unknown
       *     --known kkk op => [op], []
       *     op --known kkk => [op], []
       *     sub --unknown uuu op => [sub], [--unknown uuu op]
       *     sub -- --unknown uuu op => [sub --unknown uuu op], []
       *
       * @param {string[]} args
       * @return {{operands: string[], unknown: string[]}}
       */
      parseOptions(args) {
        const operands = [];
        const unknown = [];
        let dest = operands;
        function maybeOption(arg) {
          return arg.length > 1 && arg[0] === "-";
        }
        const negativeNumberArg = (arg) => {
          if (!/^-(\d+|\d*\.\d+)(e[+-]?\d+)?$/.test(arg)) return false;
          return !this._getCommandAndAncestors().some(
            (cmd) => cmd.options.map((opt) => opt.short).some((short) => /^-\d$/.test(short))
          );
        };
        let activeVariadicOption = null;
        let activeGroup = null;
        let i = 0;
        while (i < args.length || activeGroup) {
          const arg = activeGroup ?? args[i++];
          activeGroup = null;
          if (arg === "--") {
            if (dest === unknown) dest.push(arg);
            dest.push(...args.slice(i));
            break;
          }
          if (activeVariadicOption && (!maybeOption(arg) || negativeNumberArg(arg))) {
            this.emit(`option:${activeVariadicOption.name()}`, arg);
            continue;
          }
          activeVariadicOption = null;
          if (maybeOption(arg)) {
            const option = this._findOption(arg);
            if (option) {
              if (option.required) {
                const value = args[i++];
                if (value === void 0) this.optionMissingArgument(option);
                this.emit(`option:${option.name()}`, value);
              } else if (option.optional) {
                let value = null;
                if (i < args.length && (!maybeOption(args[i]) || negativeNumberArg(args[i]))) {
                  value = args[i++];
                }
                this.emit(`option:${option.name()}`, value);
              } else {
                this.emit(`option:${option.name()}`);
              }
              activeVariadicOption = option.variadic ? option : null;
              continue;
            }
          }
          if (arg.length > 2 && arg[0] === "-" && arg[1] !== "-") {
            const option = this._findOption(`-${arg[1]}`);
            if (option) {
              if (option.required || option.optional && this._combineFlagAndOptionalValue) {
                this.emit(`option:${option.name()}`, arg.slice(2));
              } else {
                this.emit(`option:${option.name()}`);
                activeGroup = `-${arg.slice(2)}`;
              }
              continue;
            }
          }
          if (/^--[^=]+=/.test(arg)) {
            const index = arg.indexOf("=");
            const option = this._findOption(arg.slice(0, index));
            if (option && (option.required || option.optional)) {
              this.emit(`option:${option.name()}`, arg.slice(index + 1));
              continue;
            }
          }
          if (dest === operands && maybeOption(arg) && !(this.commands.length === 0 && negativeNumberArg(arg))) {
            dest = unknown;
          }
          if ((this._enablePositionalOptions || this._passThroughOptions) && operands.length === 0 && unknown.length === 0) {
            if (this._findCommand(arg)) {
              operands.push(arg);
              unknown.push(...args.slice(i));
              break;
            } else if (this._getHelpCommand() && arg === this._getHelpCommand().name()) {
              operands.push(arg, ...args.slice(i));
              break;
            } else if (this._defaultCommandName) {
              unknown.push(arg, ...args.slice(i));
              break;
            }
          }
          if (this._passThroughOptions) {
            dest.push(arg, ...args.slice(i));
            break;
          }
          dest.push(arg);
        }
        return { operands, unknown };
      }
      /**
       * Return an object containing local option values as key-value pairs.
       *
       * @return {object}
       */
      opts() {
        if (this._storeOptionsAsProperties) {
          const result = {};
          const len = this.options.length;
          for (let i = 0; i < len; i++) {
            const key = this.options[i].attributeName();
            result[key] = key === this._versionOptionName ? this._version : this[key];
          }
          return result;
        }
        return this._optionValues;
      }
      /**
       * Return an object containing merged local and global option values as key-value pairs.
       *
       * @return {object}
       */
      optsWithGlobals() {
        return this._getCommandAndAncestors().reduce(
          (combinedOptions, cmd) => Object.assign(combinedOptions, cmd.opts()),
          {}
        );
      }
      /**
       * Display error message and exit (or call exitOverride).
       *
       * @param {string} message
       * @param {object} [errorOptions]
       * @param {string} [errorOptions.code] - an id string representing the error
       * @param {number} [errorOptions.exitCode] - used with process.exit
       */
      error(message, errorOptions) {
        this._outputConfiguration.outputError(
          `${message}
`,
          this._outputConfiguration.writeErr
        );
        if (typeof this._showHelpAfterError === "string") {
          this._outputConfiguration.writeErr(`${this._showHelpAfterError}
`);
        } else if (this._showHelpAfterError) {
          this._outputConfiguration.writeErr("\n");
          this.outputHelp({ error: true });
        }
        const config = errorOptions || {};
        const exitCode = config.exitCode || 1;
        const code = config.code || "commander.error";
        this._exit(exitCode, code, message);
      }
      /**
       * Apply any option related environment variables, if option does
       * not have a value from cli or client code.
       *
       * @private
       */
      _parseOptionsEnv() {
        this.options.forEach((option) => {
          if (option.envVar && option.envVar in process2.env) {
            const optionKey = option.attributeName();
            if (this.getOptionValue(optionKey) === void 0 || ["default", "config", "env"].includes(
              this.getOptionValueSource(optionKey)
            )) {
              if (option.required || option.optional) {
                this.emit(`optionEnv:${option.name()}`, process2.env[option.envVar]);
              } else {
                this.emit(`optionEnv:${option.name()}`);
              }
            }
          }
        });
      }
      /**
       * Apply any implied option values, if option is undefined or default value.
       *
       * @private
       */
      _parseOptionsImplied() {
        const dualHelper = new DualOptions(this.options);
        const hasCustomOptionValue = (optionKey) => {
          return this.getOptionValue(optionKey) !== void 0 && !["default", "implied"].includes(this.getOptionValueSource(optionKey));
        };
        this.options.filter(
          (option) => option.implied !== void 0 && hasCustomOptionValue(option.attributeName()) && dualHelper.valueFromOption(
            this.getOptionValue(option.attributeName()),
            option
          )
        ).forEach((option) => {
          Object.keys(option.implied).filter((impliedKey) => !hasCustomOptionValue(impliedKey)).forEach((impliedKey) => {
            this.setOptionValueWithSource(
              impliedKey,
              option.implied[impliedKey],
              "implied"
            );
          });
        });
      }
      /**
       * Argument `name` is missing.
       *
       * @param {string} name
       * @private
       */
      missingArgument(name) {
        const message = `error: missing required argument '${name}'`;
        this.error(message, { code: "commander.missingArgument" });
      }
      /**
       * `Option` is missing an argument.
       *
       * @param {Option} option
       * @private
       */
      optionMissingArgument(option) {
        const message = `error: option '${option.flags}' argument missing`;
        this.error(message, { code: "commander.optionMissingArgument" });
      }
      /**
       * `Option` does not have a value, and is a mandatory option.
       *
       * @param {Option} option
       * @private
       */
      missingMandatoryOptionValue(option) {
        const message = `error: required option '${option.flags}' not specified`;
        this.error(message, { code: "commander.missingMandatoryOptionValue" });
      }
      /**
       * `Option` conflicts with another option.
       *
       * @param {Option} option
       * @param {Option} conflictingOption
       * @private
       */
      _conflictingOption(option, conflictingOption) {
        const findBestOptionFromValue = (option2) => {
          const optionKey = option2.attributeName();
          const optionValue = this.getOptionValue(optionKey);
          const negativeOption = this.options.find(
            (target) => target.negate && optionKey === target.attributeName()
          );
          const positiveOption = this.options.find(
            (target) => !target.negate && optionKey === target.attributeName()
          );
          if (negativeOption && (negativeOption.presetArg === void 0 && optionValue === false || negativeOption.presetArg !== void 0 && optionValue === negativeOption.presetArg)) {
            return negativeOption;
          }
          return positiveOption || option2;
        };
        const getErrorMessage = (option2) => {
          const bestOption = findBestOptionFromValue(option2);
          const optionKey = bestOption.attributeName();
          const source = this.getOptionValueSource(optionKey);
          if (source === "env") {
            return `environment variable '${bestOption.envVar}'`;
          }
          return `option '${bestOption.flags}'`;
        };
        const message = `error: ${getErrorMessage(option)} cannot be used with ${getErrorMessage(conflictingOption)}`;
        this.error(message, { code: "commander.conflictingOption" });
      }
      /**
       * Unknown option `flag`.
       *
       * @param {string} flag
       * @private
       */
      unknownOption(flag) {
        if (this._allowUnknownOption) return;
        let suggestion = "";
        if (flag.startsWith("--") && this._showSuggestionAfterError) {
          let candidateFlags = [];
          let command = this;
          do {
            const moreFlags = command.createHelp().visibleOptions(command).filter((option) => option.long).map((option) => option.long);
            candidateFlags = candidateFlags.concat(moreFlags);
            command = command.parent;
          } while (command && !command._enablePositionalOptions);
          suggestion = suggestSimilar(flag, candidateFlags);
        }
        const message = `error: unknown option '${flag}'${suggestion}`;
        this.error(message, { code: "commander.unknownOption" });
      }
      /**
       * Excess arguments, more than expected.
       *
       * @param {string[]} receivedArgs
       * @private
       */
      _excessArguments(receivedArgs) {
        if (this._allowExcessArguments) return;
        const expected = this.registeredArguments.length;
        const s = expected === 1 ? "" : "s";
        const forSubcommand = this.parent ? ` for '${this.name()}'` : "";
        const message = `error: too many arguments${forSubcommand}. Expected ${expected} argument${s} but got ${receivedArgs.length}.`;
        this.error(message, { code: "commander.excessArguments" });
      }
      /**
       * Unknown command.
       *
       * @private
       */
      unknownCommand() {
        const unknownName = this.args[0];
        let suggestion = "";
        if (this._showSuggestionAfterError) {
          const candidateNames = [];
          this.createHelp().visibleCommands(this).forEach((command) => {
            candidateNames.push(command.name());
            if (command.alias()) candidateNames.push(command.alias());
          });
          suggestion = suggestSimilar(unknownName, candidateNames);
        }
        const message = `error: unknown command '${unknownName}'${suggestion}`;
        this.error(message, { code: "commander.unknownCommand" });
      }
      /**
       * Get or set the program version.
       *
       * This method auto-registers the "-V, --version" option which will print the version number.
       *
       * You can optionally supply the flags and description to override the defaults.
       *
       * @param {string} [str]
       * @param {string} [flags]
       * @param {string} [description]
       * @return {(this | string | undefined)} `this` command for chaining, or version string if no arguments
       */
      version(str, flags, description) {
        if (str === void 0) return this._version;
        this._version = str;
        flags = flags || "-V, --version";
        description = description || "output the version number";
        const versionOption = this.createOption(flags, description);
        this._versionOptionName = versionOption.attributeName();
        this._registerOption(versionOption);
        this.on("option:" + versionOption.name(), () => {
          this._outputConfiguration.writeOut(`${str}
`);
          this._exit(0, "commander.version", str);
        });
        return this;
      }
      /**
       * Set the description.
       *
       * @param {string} [str]
       * @param {object} [argsDescription]
       * @return {(string|Command)}
       */
      description(str, argsDescription) {
        if (str === void 0 && argsDescription === void 0)
          return this._description;
        this._description = str;
        if (argsDescription) {
          this._argsDescription = argsDescription;
        }
        return this;
      }
      /**
       * Set the summary. Used when listed as subcommand of parent.
       *
       * @param {string} [str]
       * @return {(string|Command)}
       */
      summary(str) {
        if (str === void 0) return this._summary;
        this._summary = str;
        return this;
      }
      /**
       * Set an alias for the command.
       *
       * You may call more than once to add multiple aliases. Only the first alias is shown in the auto-generated help.
       *
       * @param {string} [alias]
       * @return {(string|Command)}
       */
      alias(alias) {
        if (alias === void 0) return this._aliases[0];
        let command = this;
        if (this.commands.length !== 0 && this.commands[this.commands.length - 1]._executableHandler) {
          command = this.commands[this.commands.length - 1];
        }
        if (alias === command._name)
          throw new Error("Command alias can't be the same as its name");
        const matchingCommand = this.parent?._findCommand(alias);
        if (matchingCommand) {
          const existingCmd = [matchingCommand.name()].concat(matchingCommand.aliases()).join("|");
          throw new Error(
            `cannot add alias '${alias}' to command '${this.name()}' as already have command '${existingCmd}'`
          );
        }
        command._aliases.push(alias);
        return this;
      }
      /**
       * Set aliases for the command.
       *
       * Only the first alias is shown in the auto-generated help.
       *
       * @param {string[]} [aliases]
       * @return {(string[]|Command)}
       */
      aliases(aliases) {
        if (aliases === void 0) return this._aliases;
        aliases.forEach((alias) => this.alias(alias));
        return this;
      }
      /**
       * Set / get the command usage `str`.
       *
       * @param {string} [str]
       * @return {(string|Command)}
       */
      usage(str) {
        if (str === void 0) {
          if (this._usage) return this._usage;
          const args = this.registeredArguments.map((arg) => {
            return humanReadableArgName(arg);
          });
          return [].concat(
            this.options.length || this._helpOption !== null ? "[options]" : [],
            this.commands.length ? "[command]" : [],
            this.registeredArguments.length ? args : []
          ).join(" ");
        }
        this._usage = str;
        return this;
      }
      /**
       * Get or set the name of the command.
       *
       * @param {string} [str]
       * @return {(string|Command)}
       */
      name(str) {
        if (str === void 0) return this._name;
        this._name = str;
        return this;
      }
      /**
       * Set/get the help group heading for this subcommand in parent command's help.
       *
       * @param {string} [heading]
       * @return {Command | string}
       */
      helpGroup(heading) {
        if (heading === void 0) return this._helpGroupHeading ?? "";
        this._helpGroupHeading = heading;
        return this;
      }
      /**
       * Set/get the default help group heading for subcommands added to this command.
       * (This does not override a group set directly on the subcommand using .helpGroup().)
       *
       * @example
       * program.commandsGroup('Development Commands:);
       * program.command('watch')...
       * program.command('lint')...
       * ...
       *
       * @param {string} [heading]
       * @returns {Command | string}
       */
      commandsGroup(heading) {
        if (heading === void 0) return this._defaultCommandGroup ?? "";
        this._defaultCommandGroup = heading;
        return this;
      }
      /**
       * Set/get the default help group heading for options added to this command.
       * (This does not override a group set directly on the option using .helpGroup().)
       *
       * @example
       * program
       *   .optionsGroup('Development Options:')
       *   .option('-d, --debug', 'output extra debugging')
       *   .option('-p, --profile', 'output profiling information')
       *
       * @param {string} [heading]
       * @returns {Command | string}
       */
      optionsGroup(heading) {
        if (heading === void 0) return this._defaultOptionGroup ?? "";
        this._defaultOptionGroup = heading;
        return this;
      }
      /**
       * @param {Option} option
       * @private
       */
      _initOptionGroup(option) {
        if (this._defaultOptionGroup && !option.helpGroupHeading)
          option.helpGroup(this._defaultOptionGroup);
      }
      /**
       * @param {Command} cmd
       * @private
       */
      _initCommandGroup(cmd) {
        if (this._defaultCommandGroup && !cmd.helpGroup())
          cmd.helpGroup(this._defaultCommandGroup);
      }
      /**
       * Set the name of the command from script filename, such as process.argv[1],
       * or require.main.filename, or __filename.
       *
       * (Used internally and public although not documented in README.)
       *
       * @example
       * program.nameFromFilename(require.main.filename);
       *
       * @param {string} filename
       * @return {Command}
       */
      nameFromFilename(filename) {
        this._name = path8.basename(filename, path8.extname(filename));
        return this;
      }
      /**
       * Get or set the directory for searching for executable subcommands of this command.
       *
       * @example
       * program.executableDir(__dirname);
       * // or
       * program.executableDir('subcommands');
       *
       * @param {string} [path]
       * @return {(string|null|Command)}
       */
      executableDir(path9) {
        if (path9 === void 0) return this._executableDir;
        this._executableDir = path9;
        return this;
      }
      /**
       * Return program help documentation.
       *
       * @param {{ error: boolean }} [contextOptions] - pass {error:true} to wrap for stderr instead of stdout
       * @return {string}
       */
      helpInformation(contextOptions) {
        const helper = this.createHelp();
        const context = this._getOutputContext(contextOptions);
        helper.prepareContext({
          error: context.error,
          helpWidth: context.helpWidth,
          outputHasColors: context.hasColors
        });
        const text2 = helper.formatHelp(this, helper);
        if (context.hasColors) return text2;
        return this._outputConfiguration.stripColor(text2);
      }
      /**
       * @typedef HelpContext
       * @type {object}
       * @property {boolean} error
       * @property {number} helpWidth
       * @property {boolean} hasColors
       * @property {function} write - includes stripColor if needed
       *
       * @returns {HelpContext}
       * @private
       */
      _getOutputContext(contextOptions) {
        contextOptions = contextOptions || {};
        const error = !!contextOptions.error;
        let baseWrite;
        let hasColors;
        let helpWidth;
        if (error) {
          baseWrite = (str) => this._outputConfiguration.writeErr(str);
          hasColors = this._outputConfiguration.getErrHasColors();
          helpWidth = this._outputConfiguration.getErrHelpWidth();
        } else {
          baseWrite = (str) => this._outputConfiguration.writeOut(str);
          hasColors = this._outputConfiguration.getOutHasColors();
          helpWidth = this._outputConfiguration.getOutHelpWidth();
        }
        const write = (str) => {
          if (!hasColors) str = this._outputConfiguration.stripColor(str);
          return baseWrite(str);
        };
        return { error, write, hasColors, helpWidth };
      }
      /**
       * Output help information for this command.
       *
       * Outputs built-in help, and custom text added using `.addHelpText()`.
       *
       * @param {{ error: boolean } | Function} [contextOptions] - pass {error:true} to write to stderr instead of stdout
       */
      outputHelp(contextOptions) {
        let deprecatedCallback;
        if (typeof contextOptions === "function") {
          deprecatedCallback = contextOptions;
          contextOptions = void 0;
        }
        const outputContext = this._getOutputContext(contextOptions);
        const eventContext = {
          error: outputContext.error,
          write: outputContext.write,
          command: this
        };
        this._getCommandAndAncestors().reverse().forEach((command) => command.emit("beforeAllHelp", eventContext));
        this.emit("beforeHelp", eventContext);
        let helpInformation = this.helpInformation({ error: outputContext.error });
        if (deprecatedCallback) {
          helpInformation = deprecatedCallback(helpInformation);
          if (typeof helpInformation !== "string" && !Buffer.isBuffer(helpInformation)) {
            throw new Error("outputHelp callback must return a string or a Buffer");
          }
        }
        outputContext.write(helpInformation);
        if (this._getHelpOption()?.long) {
          this.emit(this._getHelpOption().long);
        }
        this.emit("afterHelp", eventContext);
        this._getCommandAndAncestors().forEach(
          (command) => command.emit("afterAllHelp", eventContext)
        );
      }
      /**
       * You can pass in flags and a description to customise the built-in help option.
       * Pass in false to disable the built-in help option.
       *
       * @example
       * program.helpOption('-?, --help' 'show help'); // customise
       * program.helpOption(false); // disable
       *
       * @param {(string | boolean)} flags
       * @param {string} [description]
       * @return {Command} `this` command for chaining
       */
      helpOption(flags, description) {
        if (typeof flags === "boolean") {
          if (flags) {
            if (this._helpOption === null) this._helpOption = void 0;
            if (this._defaultOptionGroup) {
              this._initOptionGroup(this._getHelpOption());
            }
          } else {
            this._helpOption = null;
          }
          return this;
        }
        this._helpOption = this.createOption(
          flags ?? "-h, --help",
          description ?? "display help for command"
        );
        if (flags || description) this._initOptionGroup(this._helpOption);
        return this;
      }
      /**
       * Lazy create help option.
       * Returns null if has been disabled with .helpOption(false).
       *
       * @returns {(Option | null)} the help option
       * @package
       */
      _getHelpOption() {
        if (this._helpOption === void 0) {
          this.helpOption(void 0, void 0);
        }
        return this._helpOption;
      }
      /**
       * Supply your own option to use for the built-in help option.
       * This is an alternative to using helpOption() to customise the flags and description etc.
       *
       * @param {Option} option
       * @return {Command} `this` command for chaining
       */
      addHelpOption(option) {
        this._helpOption = option;
        this._initOptionGroup(option);
        return this;
      }
      /**
       * Output help information and exit.
       *
       * Outputs built-in help, and custom text added using `.addHelpText()`.
       *
       * @param {{ error: boolean }} [contextOptions] - pass {error:true} to write to stderr instead of stdout
       */
      help(contextOptions) {
        this.outputHelp(contextOptions);
        let exitCode = Number(process2.exitCode ?? 0);
        if (exitCode === 0 && contextOptions && typeof contextOptions !== "function" && contextOptions.error) {
          exitCode = 1;
        }
        this._exit(exitCode, "commander.help", "(outputHelp)");
      }
      /**
       * // Do a little typing to coordinate emit and listener for the help text events.
       * @typedef HelpTextEventContext
       * @type {object}
       * @property {boolean} error
       * @property {Command} command
       * @property {function} write
       */
      /**
       * Add additional text to be displayed with the built-in help.
       *
       * Position is 'before' or 'after' to affect just this command,
       * and 'beforeAll' or 'afterAll' to affect this command and all its subcommands.
       *
       * @param {string} position - before or after built-in help
       * @param {(string | Function)} text - string to add, or a function returning a string
       * @return {Command} `this` command for chaining
       */
      addHelpText(position, text2) {
        const allowedValues = ["beforeAll", "before", "after", "afterAll"];
        if (!allowedValues.includes(position)) {
          throw new Error(`Unexpected value for position to addHelpText.
Expecting one of '${allowedValues.join("', '")}'`);
        }
        const helpEvent = `${position}Help`;
        this.on(helpEvent, (context) => {
          let helpStr;
          if (typeof text2 === "function") {
            helpStr = text2({ error: context.error, command: context.command });
          } else {
            helpStr = text2;
          }
          if (helpStr) {
            context.write(`${helpStr}
`);
          }
        });
        return this;
      }
      /**
       * Output help information if help flags specified
       *
       * @param {Array} args - array of options to search for help flags
       * @private
       */
      _outputHelpIfRequested(args) {
        const helpOption = this._getHelpOption();
        const helpRequested = helpOption && args.find((arg) => helpOption.is(arg));
        if (helpRequested) {
          this.outputHelp();
          this._exit(0, "commander.helpDisplayed", "(outputHelp)");
        }
      }
    };
    function incrementNodeInspectorPort(args) {
      return args.map((arg) => {
        if (!arg.startsWith("--inspect")) {
          return arg;
        }
        let debugOption;
        let debugHost = "127.0.0.1";
        let debugPort = "9229";
        let match;
        if ((match = arg.match(/^(--inspect(-brk)?)$/)) !== null) {
          debugOption = match[1];
        } else if ((match = arg.match(/^(--inspect(-brk|-port)?)=([^:]+)$/)) !== null) {
          debugOption = match[1];
          if (/^\d+$/.test(match[3])) {
            debugPort = match[3];
          } else {
            debugHost = match[3];
          }
        } else if ((match = arg.match(/^(--inspect(-brk|-port)?)=([^:]+):(\d+)$/)) !== null) {
          debugOption = match[1];
          debugHost = match[3];
          debugPort = match[4];
        }
        if (debugOption && debugPort !== "0") {
          return `${debugOption}=${debugHost}:${parseInt(debugPort) + 1}`;
        }
        return arg;
      });
    }
    function useColor() {
      if (process2.env.NO_COLOR || process2.env.FORCE_COLOR === "0" || process2.env.FORCE_COLOR === "false")
        return false;
      if (process2.env.FORCE_COLOR || process2.env.CLICOLOR_FORCE !== void 0)
        return true;
      return void 0;
    }
    exports.Command = Command2;
    exports.useColor = useColor;
  }
});

// node_modules/commander/index.js
var require_commander = __commonJS({
  "node_modules/commander/index.js"(exports) {
    "use strict";
    var { Argument: Argument2 } = require_argument();
    var { Command: Command2 } = require_command();
    var { CommanderError: CommanderError2, InvalidArgumentError: InvalidArgumentError2 } = require_error();
    var { Help: Help2 } = require_help();
    var { Option: Option2 } = require_option();
    exports.program = new Command2();
    exports.createCommand = (name) => new Command2(name);
    exports.createOption = (flags, description) => new Option2(flags, description);
    exports.createArgument = (name, description) => new Argument2(name, description);
    exports.Command = Command2;
    exports.Option = Option2;
    exports.Argument = Argument2;
    exports.Help = Help2;
    exports.CommanderError = CommanderError2;
    exports.InvalidArgumentError = InvalidArgumentError2;
    exports.InvalidOptionArgumentError = InvalidArgumentError2;
  }
});

// node_modules/picocolors/picocolors.js
var require_picocolors = __commonJS({
  "node_modules/picocolors/picocolors.js"(exports, module) {
    "use strict";
    var p = process || {};
    var argv = p.argv || [];
    var env = p.env || {};
    var isColorSupported = !(!!env.NO_COLOR || argv.includes("--no-color")) && (!!env.FORCE_COLOR || argv.includes("--color") || p.platform === "win32" || (p.stdout || {}).isTTY && env.TERM !== "dumb" || !!env.CI);
    var formatter = (open, close, replace = open) => (input) => {
      let string = "" + input, index = string.indexOf(close, open.length);
      return ~index ? open + replaceClose(string, close, replace, index) + close : open + string + close;
    };
    var replaceClose = (string, close, replace, index) => {
      let result = "", cursor = 0;
      do {
        result += string.substring(cursor, index) + replace;
        cursor = index + close.length;
        index = string.indexOf(close, cursor);
      } while (~index);
      return result + string.substring(cursor);
    };
    var createColors = (enabled = isColorSupported) => {
      let f = enabled ? formatter : () => String;
      return {
        isColorSupported: enabled,
        reset: f("\x1B[0m", "\x1B[0m"),
        bold: f("\x1B[1m", "\x1B[22m", "\x1B[22m\x1B[1m"),
        dim: f("\x1B[2m", "\x1B[22m", "\x1B[22m\x1B[2m"),
        italic: f("\x1B[3m", "\x1B[23m"),
        underline: f("\x1B[4m", "\x1B[24m"),
        inverse: f("\x1B[7m", "\x1B[27m"),
        hidden: f("\x1B[8m", "\x1B[28m"),
        strikethrough: f("\x1B[9m", "\x1B[29m"),
        black: f("\x1B[30m", "\x1B[39m"),
        red: f("\x1B[31m", "\x1B[39m"),
        green: f("\x1B[32m", "\x1B[39m"),
        yellow: f("\x1B[33m", "\x1B[39m"),
        blue: f("\x1B[34m", "\x1B[39m"),
        magenta: f("\x1B[35m", "\x1B[39m"),
        cyan: f("\x1B[36m", "\x1B[39m"),
        white: f("\x1B[37m", "\x1B[39m"),
        gray: f("\x1B[90m", "\x1B[39m"),
        bgBlack: f("\x1B[40m", "\x1B[49m"),
        bgRed: f("\x1B[41m", "\x1B[49m"),
        bgGreen: f("\x1B[42m", "\x1B[49m"),
        bgYellow: f("\x1B[43m", "\x1B[49m"),
        bgBlue: f("\x1B[44m", "\x1B[49m"),
        bgMagenta: f("\x1B[45m", "\x1B[49m"),
        bgCyan: f("\x1B[46m", "\x1B[49m"),
        bgWhite: f("\x1B[47m", "\x1B[49m"),
        blackBright: f("\x1B[90m", "\x1B[39m"),
        redBright: f("\x1B[91m", "\x1B[39m"),
        greenBright: f("\x1B[92m", "\x1B[39m"),
        yellowBright: f("\x1B[93m", "\x1B[39m"),
        blueBright: f("\x1B[94m", "\x1B[39m"),
        magentaBright: f("\x1B[95m", "\x1B[39m"),
        cyanBright: f("\x1B[96m", "\x1B[39m"),
        whiteBright: f("\x1B[97m", "\x1B[39m"),
        bgBlackBright: f("\x1B[100m", "\x1B[49m"),
        bgRedBright: f("\x1B[101m", "\x1B[49m"),
        bgGreenBright: f("\x1B[102m", "\x1B[49m"),
        bgYellowBright: f("\x1B[103m", "\x1B[49m"),
        bgBlueBright: f("\x1B[104m", "\x1B[49m"),
        bgMagentaBright: f("\x1B[105m", "\x1B[49m"),
        bgCyanBright: f("\x1B[106m", "\x1B[49m"),
        bgWhiteBright: f("\x1B[107m", "\x1B[49m")
      };
    };
    module.exports = createColors();
    module.exports.createColors = createColors;
  }
});

// node_modules/sisteransi/src/index.js
var require_src = __commonJS({
  "node_modules/sisteransi/src/index.js"(exports, module) {
    "use strict";
    var ESC = "\x1B";
    var CSI = `${ESC}[`;
    var beep = "\x07";
    var cursor = {
      to(x3, y2) {
        if (!y2) return `${CSI}${x3 + 1}G`;
        return `${CSI}${y2 + 1};${x3 + 1}H`;
      },
      move(x3, y2) {
        let ret = "";
        if (x3 < 0) ret += `${CSI}${-x3}D`;
        else if (x3 > 0) ret += `${CSI}${x3}C`;
        if (y2 < 0) ret += `${CSI}${-y2}A`;
        else if (y2 > 0) ret += `${CSI}${y2}B`;
        return ret;
      },
      up: (count = 1) => `${CSI}${count}A`,
      down: (count = 1) => `${CSI}${count}B`,
      forward: (count = 1) => `${CSI}${count}C`,
      backward: (count = 1) => `${CSI}${count}D`,
      nextLine: (count = 1) => `${CSI}E`.repeat(count),
      prevLine: (count = 1) => `${CSI}F`.repeat(count),
      left: `${CSI}G`,
      hide: `${CSI}?25l`,
      show: `${CSI}?25h`,
      save: `${ESC}7`,
      restore: `${ESC}8`
    };
    var scroll = {
      up: (count = 1) => `${CSI}S`.repeat(count),
      down: (count = 1) => `${CSI}T`.repeat(count)
    };
    var erase = {
      screen: `${CSI}2J`,
      up: (count = 1) => `${CSI}1J`.repeat(count),
      down: (count = 1) => `${CSI}J`.repeat(count),
      line: `${CSI}2K`,
      lineEnd: `${CSI}K`,
      lineStart: `${CSI}1K`,
      lines(count) {
        let clear = "";
        for (let i = 0; i < count; i++)
          clear += this.line + (i < count - 1 ? cursor.up() : "");
        if (count)
          clear += cursor.left;
        return clear;
      }
    };
    module.exports = { cursor, scroll, erase, beep };
  }
});

// node_modules/commander/esm.mjs
var import_index = __toESM(require_commander(), 1);
var {
  program,
  createCommand,
  createArgument,
  createOption,
  CommanderError,
  InvalidArgumentError,
  InvalidOptionArgumentError,
  // deprecated old name
  Command,
  Argument,
  Option,
  Help
} = import_index.default;

// bin/learnhouse.ts
var import_picocolors18 = __toESM(require_picocolors(), 1);

// src/constants.ts
var VERSION = "1.1.0";
var APP_IMAGE = "ghcr.io/learnhouse/app:latest";
var DEV_IMAGE = "ghcr.io/learnhouse/app:dev";
var POSTGRES_IMAGE = "postgres:16-alpine";
var POSTGRES_AI_IMAGE = "pgvector/pgvector:pg16";
var HEALTH_CHECK_TIMEOUT_MS = 18e4;
var HEALTH_CHECK_INTERVAL_MS = 3e3;
var CONFIG_FILENAME = "learnhouse.config.json";

// src/ui/banner.ts
var import_picocolors = __toESM(require_picocolors(), 1);
var ICON = [
  "          \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588          ",
  "         \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588         ",
  "         \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588         ",
  "       \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588  \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588       ",
  "     \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588  \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588     ",
  "\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588    \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588",
  "\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588      \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588",
  "\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588          \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588",
  "\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588              \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588",
  "\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588                  \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588",
  "\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588                        \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588"
];
var ICON_W = Math.max(...ICON.map((l) => l.length));
function center(s, width) {
  const pad = Math.max(0, width - s.length);
  return " ".repeat(Math.floor(pad / 2)) + s;
}
function stripAnsi(s) {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}
function padStyled(styled, width) {
  const visible = stripAnsi(styled).length;
  return styled + " ".repeat(Math.max(0, width - visible));
}
var BOX_W = 44;
function boxLine(content) {
  return import_picocolors.default.dim("\u2502") + " " + padStyled(content, BOX_W) + " " + import_picocolors.default.dim("\u2502");
}
function buildInfoBox() {
  const top = import_picocolors.default.dim("\u250C" + "\u2500".repeat(BOX_W + 2) + "\u2510");
  const bot = import_picocolors.default.dim("\u2514" + "\u2500".repeat(BOX_W + 2) + "\u2518");
  const sep = import_picocolors.default.dim("\u2500".repeat(BOX_W));
  const empty = boxLine("");
  return [
    top,
    boxLine(import_picocolors.default.bold(import_picocolors.default.white("LearnHouse")) + import_picocolors.default.dim(` // v${VERSION}`)),
    boxLine(sep),
    boxLine(import_picocolors.default.white("Deploy LearnHouse with a single command.")),
    boxLine(import_picocolors.default.white("Handles configuration, Docker, SSL, DB.")),
    empty,
    boxLine(import_picocolors.default.white("> ") + import_picocolors.default.dim("npx learnhouse@latest")),
    bot
  ];
}
async function printBanner() {
  console.log();
  for (const line of ICON) {
    console.log(import_picocolors.default.white(center(line, ICON_W)));
  }
  console.log();
  const box = buildInfoBox();
  for (const line of box) {
    const visible = stripAnsi(line).length;
    const pad = Math.max(0, Math.floor((ICON_W - visible) / 2));
    console.log(" ".repeat(pad) + line);
  }
  console.log();
}

// src/services/version-check.ts
var import_picocolors2 = __toESM(require_picocolors(), 1);
var NPM_REGISTRY_URL = "https://registry.npmjs.org/learnhouse";
var GHCR_BASE = "ghcr.io/learnhouse/app";
function compareVersions(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}
async function checkForUpdates() {
  try {
    const resp = await fetch(NPM_REGISTRY_URL, {
      signal: AbortSignal.timeout(3e3),
      headers: { Accept: "application/json" }
    });
    if (!resp.ok) return;
    const data = await resp.json();
    const latest = data["dist-tags"]?.latest;
    if (!latest) return;
    if (compareVersions(latest, VERSION) > 0) {
      console.log();
      console.log(import_picocolors2.default.yellow(`  Update available: ${VERSION} \u2192 ${import_picocolors2.default.bold(latest)}`));
      console.log(import_picocolors2.default.dim(`  Run: npx learnhouse@latest`));
      console.log();
    }
  } catch {
  }
}
async function resolveAppImage(channel = "stable") {
  if (channel === "dev") {
    return { image: DEV_IMAGE, isLatest: false };
  }
  const versionedTag = `${GHCR_BASE}:${VERSION}`;
  try {
    const tokenResp = await fetch(
      `https://ghcr.io/token?scope=repository:learnhouse/app:pull`,
      { signal: AbortSignal.timeout(5e3) }
    );
    if (!tokenResp.ok) throw new Error("token fetch failed");
    const { token } = await tokenResp.json();
    const manifestResp = await fetch(
      `https://ghcr.io/v2/learnhouse/app/manifests/${VERSION}`,
      {
        signal: AbortSignal.timeout(5e3),
        headers: {
          Accept: "application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json",
          Authorization: `Bearer ${token}`
        }
      }
    );
    if (manifestResp.ok) {
      return { image: versionedTag, isLatest: false };
    }
  } catch {
  }
  return { image: `${GHCR_BASE}:latest`, isLatest: true };
}

// src/commands/setup.ts
import crypto3 from "crypto";
import fs2 from "fs";
import path2 from "path";

// node_modules/@clack/core/dist/index.mjs
var import_picocolors3 = __toESM(require_picocolors(), 1);
var import_sisteransi = __toESM(require_src(), 1);
import { stdout as R, stdin as q } from "process";
import * as k from "readline";
import ot from "readline";
import { ReadStream as J } from "tty";
function B(t, e2, s) {
  if (!s.some((u) => !u.disabled)) return t;
  const i = t + e2, r = Math.max(s.length - 1, 0), n = i < 0 ? r : i > r ? 0 : i;
  return s[n].disabled ? B(n, e2 < 0 ? -1 : 1, s) : n;
}
var at = (t) => t === 161 || t === 164 || t === 167 || t === 168 || t === 170 || t === 173 || t === 174 || t >= 176 && t <= 180 || t >= 182 && t <= 186 || t >= 188 && t <= 191 || t === 198 || t === 208 || t === 215 || t === 216 || t >= 222 && t <= 225 || t === 230 || t >= 232 && t <= 234 || t === 236 || t === 237 || t === 240 || t === 242 || t === 243 || t >= 247 && t <= 250 || t === 252 || t === 254 || t === 257 || t === 273 || t === 275 || t === 283 || t === 294 || t === 295 || t === 299 || t >= 305 && t <= 307 || t === 312 || t >= 319 && t <= 322 || t === 324 || t >= 328 && t <= 331 || t === 333 || t === 338 || t === 339 || t === 358 || t === 359 || t === 363 || t === 462 || t === 464 || t === 466 || t === 468 || t === 470 || t === 472 || t === 474 || t === 476 || t === 593 || t === 609 || t === 708 || t === 711 || t >= 713 && t <= 715 || t === 717 || t === 720 || t >= 728 && t <= 731 || t === 733 || t === 735 || t >= 768 && t <= 879 || t >= 913 && t <= 929 || t >= 931 && t <= 937 || t >= 945 && t <= 961 || t >= 963 && t <= 969 || t === 1025 || t >= 1040 && t <= 1103 || t === 1105 || t === 8208 || t >= 8211 && t <= 8214 || t === 8216 || t === 8217 || t === 8220 || t === 8221 || t >= 8224 && t <= 8226 || t >= 8228 && t <= 8231 || t === 8240 || t === 8242 || t === 8243 || t === 8245 || t === 8251 || t === 8254 || t === 8308 || t === 8319 || t >= 8321 && t <= 8324 || t === 8364 || t === 8451 || t === 8453 || t === 8457 || t === 8467 || t === 8470 || t === 8481 || t === 8482 || t === 8486 || t === 8491 || t === 8531 || t === 8532 || t >= 8539 && t <= 8542 || t >= 8544 && t <= 8555 || t >= 8560 && t <= 8569 || t === 8585 || t >= 8592 && t <= 8601 || t === 8632 || t === 8633 || t === 8658 || t === 8660 || t === 8679 || t === 8704 || t === 8706 || t === 8707 || t === 8711 || t === 8712 || t === 8715 || t === 8719 || t === 8721 || t === 8725 || t === 8730 || t >= 8733 && t <= 8736 || t === 8739 || t === 8741 || t >= 8743 && t <= 8748 || t === 8750 || t >= 8756 && t <= 8759 || t === 8764 || t === 8765 || t === 8776 || t === 8780 || t === 8786 || t === 8800 || t === 8801 || t >= 8804 && t <= 8807 || t === 8810 || t === 8811 || t === 8814 || t === 8815 || t === 8834 || t === 8835 || t === 8838 || t === 8839 || t === 8853 || t === 8857 || t === 8869 || t === 8895 || t === 8978 || t >= 9312 && t <= 9449 || t >= 9451 && t <= 9547 || t >= 9552 && t <= 9587 || t >= 9600 && t <= 9615 || t >= 9618 && t <= 9621 || t === 9632 || t === 9633 || t >= 9635 && t <= 9641 || t === 9650 || t === 9651 || t === 9654 || t === 9655 || t === 9660 || t === 9661 || t === 9664 || t === 9665 || t >= 9670 && t <= 9672 || t === 9675 || t >= 9678 && t <= 9681 || t >= 9698 && t <= 9701 || t === 9711 || t === 9733 || t === 9734 || t === 9737 || t === 9742 || t === 9743 || t === 9756 || t === 9758 || t === 9792 || t === 9794 || t === 9824 || t === 9825 || t >= 9827 && t <= 9829 || t >= 9831 && t <= 9834 || t === 9836 || t === 9837 || t === 9839 || t === 9886 || t === 9887 || t === 9919 || t >= 9926 && t <= 9933 || t >= 9935 && t <= 9939 || t >= 9941 && t <= 9953 || t === 9955 || t === 9960 || t === 9961 || t >= 9963 && t <= 9969 || t === 9972 || t >= 9974 && t <= 9977 || t === 9979 || t === 9980 || t === 9982 || t === 9983 || t === 10045 || t >= 10102 && t <= 10111 || t >= 11094 && t <= 11097 || t >= 12872 && t <= 12879 || t >= 57344 && t <= 63743 || t >= 65024 && t <= 65039 || t === 65533 || t >= 127232 && t <= 127242 || t >= 127248 && t <= 127277 || t >= 127280 && t <= 127337 || t >= 127344 && t <= 127373 || t === 127375 || t === 127376 || t >= 127387 && t <= 127404 || t >= 917760 && t <= 917999 || t >= 983040 && t <= 1048573 || t >= 1048576 && t <= 1114109;
var lt = (t) => t === 12288 || t >= 65281 && t <= 65376 || t >= 65504 && t <= 65510;
var ht = (t) => t >= 4352 && t <= 4447 || t === 8986 || t === 8987 || t === 9001 || t === 9002 || t >= 9193 && t <= 9196 || t === 9200 || t === 9203 || t === 9725 || t === 9726 || t === 9748 || t === 9749 || t >= 9800 && t <= 9811 || t === 9855 || t === 9875 || t === 9889 || t === 9898 || t === 9899 || t === 9917 || t === 9918 || t === 9924 || t === 9925 || t === 9934 || t === 9940 || t === 9962 || t === 9970 || t === 9971 || t === 9973 || t === 9978 || t === 9981 || t === 9989 || t === 9994 || t === 9995 || t === 10024 || t === 10060 || t === 10062 || t >= 10067 && t <= 10069 || t === 10071 || t >= 10133 && t <= 10135 || t === 10160 || t === 10175 || t === 11035 || t === 11036 || t === 11088 || t === 11093 || t >= 11904 && t <= 11929 || t >= 11931 && t <= 12019 || t >= 12032 && t <= 12245 || t >= 12272 && t <= 12287 || t >= 12289 && t <= 12350 || t >= 12353 && t <= 12438 || t >= 12441 && t <= 12543 || t >= 12549 && t <= 12591 || t >= 12593 && t <= 12686 || t >= 12688 && t <= 12771 || t >= 12783 && t <= 12830 || t >= 12832 && t <= 12871 || t >= 12880 && t <= 19903 || t >= 19968 && t <= 42124 || t >= 42128 && t <= 42182 || t >= 43360 && t <= 43388 || t >= 44032 && t <= 55203 || t >= 63744 && t <= 64255 || t >= 65040 && t <= 65049 || t >= 65072 && t <= 65106 || t >= 65108 && t <= 65126 || t >= 65128 && t <= 65131 || t >= 94176 && t <= 94180 || t === 94192 || t === 94193 || t >= 94208 && t <= 100343 || t >= 100352 && t <= 101589 || t >= 101632 && t <= 101640 || t >= 110576 && t <= 110579 || t >= 110581 && t <= 110587 || t === 110589 || t === 110590 || t >= 110592 && t <= 110882 || t === 110898 || t >= 110928 && t <= 110930 || t === 110933 || t >= 110948 && t <= 110951 || t >= 110960 && t <= 111355 || t === 126980 || t === 127183 || t === 127374 || t >= 127377 && t <= 127386 || t >= 127488 && t <= 127490 || t >= 127504 && t <= 127547 || t >= 127552 && t <= 127560 || t === 127568 || t === 127569 || t >= 127584 && t <= 127589 || t >= 127744 && t <= 127776 || t >= 127789 && t <= 127797 || t >= 127799 && t <= 127868 || t >= 127870 && t <= 127891 || t >= 127904 && t <= 127946 || t >= 127951 && t <= 127955 || t >= 127968 && t <= 127984 || t === 127988 || t >= 127992 && t <= 128062 || t === 128064 || t >= 128066 && t <= 128252 || t >= 128255 && t <= 128317 || t >= 128331 && t <= 128334 || t >= 128336 && t <= 128359 || t === 128378 || t === 128405 || t === 128406 || t === 128420 || t >= 128507 && t <= 128591 || t >= 128640 && t <= 128709 || t === 128716 || t >= 128720 && t <= 128722 || t >= 128725 && t <= 128727 || t >= 128732 && t <= 128735 || t === 128747 || t === 128748 || t >= 128756 && t <= 128764 || t >= 128992 && t <= 129003 || t === 129008 || t >= 129292 && t <= 129338 || t >= 129340 && t <= 129349 || t >= 129351 && t <= 129535 || t >= 129648 && t <= 129660 || t >= 129664 && t <= 129672 || t >= 129680 && t <= 129725 || t >= 129727 && t <= 129733 || t >= 129742 && t <= 129755 || t >= 129760 && t <= 129768 || t >= 129776 && t <= 129784 || t >= 131072 && t <= 196605 || t >= 196608 && t <= 262141;
var O = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/y;
var y = /[\x00-\x08\x0A-\x1F\x7F-\x9F]{1,1000}/y;
var L = /\t{1,1000}/y;
var P = new RegExp("[\\u{1F1E6}-\\u{1F1FF}]{2}|\\u{1F3F4}[\\u{E0061}-\\u{E007A}]{2}[\\u{E0030}-\\u{E0039}\\u{E0061}-\\u{E007A}]{1,3}\\u{E007F}|(?:\\p{Emoji}\\uFE0F\\u20E3?|\\p{Emoji_Modifier_Base}\\p{Emoji_Modifier}?|\\p{Emoji_Presentation})(?:\\u200D(?:\\p{Emoji_Modifier_Base}\\p{Emoji_Modifier}?|\\p{Emoji_Presentation}|\\p{Emoji}\\uFE0F\\u20E3?))*", "yu");
var M = /(?:[\x20-\x7E\xA0-\xFF](?!\uFE0F)){1,1000}/y;
var ct = new RegExp("\\p{M}+", "gu");
var ft = { limit: 1 / 0, ellipsis: "" };
var X = (t, e2 = {}, s = {}) => {
  const i = e2.limit ?? 1 / 0, r = e2.ellipsis ?? "", n = e2?.ellipsisWidth ?? (r ? X(r, ft, s).width : 0), u = s.ansiWidth ?? 0, a = s.controlWidth ?? 0, l = s.tabWidth ?? 8, E = s.ambiguousWidth ?? 1, g = s.emojiWidth ?? 2, m = s.fullWidthWidth ?? 2, A = s.regularWidth ?? 1, V2 = s.wideWidth ?? 2;
  let h = 0, o = 0, p = t.length, v = 0, F = false, d2 = p, b = Math.max(0, i - n), C2 = 0, w = 0, c = 0, f = 0;
  t: for (; ; ) {
    if (w > C2 || o >= p && o > h) {
      const ut2 = t.slice(C2, w) || t.slice(h, o);
      v = 0;
      for (const Y of ut2.replaceAll(ct, "")) {
        const $ = Y.codePointAt(0) || 0;
        if (lt($) ? f = m : ht($) ? f = V2 : E !== A && at($) ? f = E : f = A, c + f > b && (d2 = Math.min(d2, Math.max(C2, h) + v)), c + f > i) {
          F = true;
          break t;
        }
        v += Y.length, c += f;
      }
      C2 = w = 0;
    }
    if (o >= p) break;
    if (M.lastIndex = o, M.test(t)) {
      if (v = M.lastIndex - o, f = v * A, c + f > b && (d2 = Math.min(d2, o + Math.floor((b - c) / A))), c + f > i) {
        F = true;
        break;
      }
      c += f, C2 = h, w = o, o = h = M.lastIndex;
      continue;
    }
    if (O.lastIndex = o, O.test(t)) {
      if (c + u > b && (d2 = Math.min(d2, o)), c + u > i) {
        F = true;
        break;
      }
      c += u, C2 = h, w = o, o = h = O.lastIndex;
      continue;
    }
    if (y.lastIndex = o, y.test(t)) {
      if (v = y.lastIndex - o, f = v * a, c + f > b && (d2 = Math.min(d2, o + Math.floor((b - c) / a))), c + f > i) {
        F = true;
        break;
      }
      c += f, C2 = h, w = o, o = h = y.lastIndex;
      continue;
    }
    if (L.lastIndex = o, L.test(t)) {
      if (v = L.lastIndex - o, f = v * l, c + f > b && (d2 = Math.min(d2, o + Math.floor((b - c) / l))), c + f > i) {
        F = true;
        break;
      }
      c += f, C2 = h, w = o, o = h = L.lastIndex;
      continue;
    }
    if (P.lastIndex = o, P.test(t)) {
      if (c + g > b && (d2 = Math.min(d2, o)), c + g > i) {
        F = true;
        break;
      }
      c += g, C2 = h, w = o, o = h = P.lastIndex;
      continue;
    }
    o += 1;
  }
  return { width: F ? b : c, index: F ? d2 : p, truncated: F, ellipsed: F && i >= n };
};
var pt = { limit: 1 / 0, ellipsis: "", ellipsisWidth: 0 };
var S = (t, e2 = {}) => X(t, pt, e2).width;
var W = "\x1B";
var Z = "\x9B";
var Ft = 39;
var j = "\x07";
var Q = "[";
var dt = "]";
var tt = "m";
var U = `${dt}8;;`;
var et = new RegExp(`(?:\\${Q}(?<code>\\d+)m|\\${U}(?<uri>.*)${j})`, "y");
var mt = (t) => {
  if (t >= 30 && t <= 37 || t >= 90 && t <= 97) return 39;
  if (t >= 40 && t <= 47 || t >= 100 && t <= 107) return 49;
  if (t === 1 || t === 2) return 22;
  if (t === 3) return 23;
  if (t === 4) return 24;
  if (t === 7) return 27;
  if (t === 8) return 28;
  if (t === 9) return 29;
  if (t === 0) return 0;
};
var st = (t) => `${W}${Q}${t}${tt}`;
var it = (t) => `${W}${U}${t}${j}`;
var gt = (t) => t.map((e2) => S(e2));
var G = (t, e2, s) => {
  const i = e2[Symbol.iterator]();
  let r = false, n = false, u = t.at(-1), a = u === void 0 ? 0 : S(u), l = i.next(), E = i.next(), g = 0;
  for (; !l.done; ) {
    const m = l.value, A = S(m);
    a + A <= s ? t[t.length - 1] += m : (t.push(m), a = 0), (m === W || m === Z) && (r = true, n = e2.startsWith(U, g + 1)), r ? n ? m === j && (r = false, n = false) : m === tt && (r = false) : (a += A, a === s && !E.done && (t.push(""), a = 0)), l = E, E = i.next(), g += m.length;
  }
  u = t.at(-1), !a && u !== void 0 && u.length > 0 && t.length > 1 && (t[t.length - 2] += t.pop());
};
var vt = (t) => {
  const e2 = t.split(" ");
  let s = e2.length;
  for (; s > 0 && !(S(e2[s - 1]) > 0); ) s--;
  return s === e2.length ? t : e2.slice(0, s).join(" ") + e2.slice(s).join("");
};
var Et = (t, e2, s = {}) => {
  if (s.trim !== false && t.trim() === "") return "";
  let i = "", r, n;
  const u = t.split(" "), a = gt(u);
  let l = [""];
  for (const [h, o] of u.entries()) {
    s.trim !== false && (l[l.length - 1] = (l.at(-1) ?? "").trimStart());
    let p = S(l.at(-1) ?? "");
    if (h !== 0 && (p >= e2 && (s.wordWrap === false || s.trim === false) && (l.push(""), p = 0), (p > 0 || s.trim === false) && (l[l.length - 1] += " ", p++)), s.hard && a[h] > e2) {
      const v = e2 - p, F = 1 + Math.floor((a[h] - v - 1) / e2);
      Math.floor((a[h] - 1) / e2) < F && l.push(""), G(l, o, e2);
      continue;
    }
    if (p + a[h] > e2 && p > 0 && a[h] > 0) {
      if (s.wordWrap === false && p < e2) {
        G(l, o, e2);
        continue;
      }
      l.push("");
    }
    if (p + a[h] > e2 && s.wordWrap === false) {
      G(l, o, e2);
      continue;
    }
    l[l.length - 1] += o;
  }
  s.trim !== false && (l = l.map((h) => vt(h)));
  const E = l.join(`
`), g = E[Symbol.iterator]();
  let m = g.next(), A = g.next(), V2 = 0;
  for (; !m.done; ) {
    const h = m.value, o = A.value;
    if (i += h, h === W || h === Z) {
      et.lastIndex = V2 + 1;
      const F = et.exec(E)?.groups;
      if (F?.code !== void 0) {
        const d2 = Number.parseFloat(F.code);
        r = d2 === Ft ? void 0 : d2;
      } else F?.uri !== void 0 && (n = F.uri.length === 0 ? void 0 : F.uri);
    }
    const p = r ? mt(r) : void 0;
    o === `
` ? (n && (i += it("")), r && p && (i += st(p))) : h === `
` && (r && p && (i += st(r)), n && (i += it(n))), V2 += h.length, m = A, A = g.next();
  }
  return i;
};
function K(t, e2, s) {
  return String(t).normalize().replaceAll(`\r
`, `
`).split(`
`).map((i) => Et(i, e2, s)).join(`
`);
}
var At = ["up", "down", "left", "right", "space", "enter", "cancel"];
var _ = { actions: new Set(At), aliases: /* @__PURE__ */ new Map([["k", "up"], ["j", "down"], ["h", "left"], ["l", "right"], ["", "cancel"], ["escape", "cancel"]]), messages: { cancel: "Canceled", error: "Something went wrong" }, withGuide: true };
function H(t, e2) {
  if (typeof t == "string") return _.aliases.get(t) === e2;
  for (const s of t) if (s !== void 0 && H(s, e2)) return true;
  return false;
}
function _t(t, e2) {
  if (t === e2) return;
  const s = t.split(`
`), i = e2.split(`
`), r = Math.max(s.length, i.length), n = [];
  for (let u = 0; u < r; u++) s[u] !== i[u] && n.push(u);
  return { lines: n, numLinesBefore: s.length, numLinesAfter: i.length, numLines: r };
}
var bt = globalThis.process.platform.startsWith("win");
var z = /* @__PURE__ */ Symbol("clack:cancel");
function Ct(t) {
  return t === z;
}
function T(t, e2) {
  const s = t;
  s.isTTY && s.setRawMode(e2);
}
function Bt({ input: t = q, output: e2 = R, overwrite: s = true, hideCursor: i = true } = {}) {
  const r = k.createInterface({ input: t, output: e2, prompt: "", tabSize: 1 });
  k.emitKeypressEvents(t, r), t instanceof J && t.isTTY && t.setRawMode(true);
  const n = (u, { name: a, sequence: l }) => {
    const E = String(u);
    if (H([E, a, l], "cancel")) {
      i && e2.write(import_sisteransi.cursor.show), process.exit(0);
      return;
    }
    if (!s) return;
    const g = a === "return" ? 0 : -1, m = a === "return" ? -1 : 0;
    k.moveCursor(e2, g, m, () => {
      k.clearLine(e2, 1, () => {
        t.once("keypress", n);
      });
    });
  };
  return i && e2.write(import_sisteransi.cursor.hide), t.once("keypress", n), () => {
    t.off("keypress", n), i && e2.write(import_sisteransi.cursor.show), t instanceof J && t.isTTY && !bt && t.setRawMode(false), r.terminal = false, r.close();
  };
}
var rt = (t) => "columns" in t && typeof t.columns == "number" ? t.columns : 80;
var nt = (t) => "rows" in t && typeof t.rows == "number" ? t.rows : 20;
function xt(t, e2, s, i = s) {
  const r = rt(t ?? R);
  return K(e2, r - s.length, { hard: true, trim: false }).split(`
`).map((n, u) => `${u === 0 ? i : s}${n}`).join(`
`);
}
var x = class {
  input;
  output;
  _abortSignal;
  rl;
  opts;
  _render;
  _track = false;
  _prevFrame = "";
  _subscribers = /* @__PURE__ */ new Map();
  _cursor = 0;
  state = "initial";
  error = "";
  value;
  userInput = "";
  constructor(e2, s = true) {
    const { input: i = q, output: r = R, render: n, signal: u, ...a } = e2;
    this.opts = a, this.onKeypress = this.onKeypress.bind(this), this.close = this.close.bind(this), this.render = this.render.bind(this), this._render = n.bind(this), this._track = s, this._abortSignal = u, this.input = i, this.output = r;
  }
  unsubscribe() {
    this._subscribers.clear();
  }
  setSubscriber(e2, s) {
    const i = this._subscribers.get(e2) ?? [];
    i.push(s), this._subscribers.set(e2, i);
  }
  on(e2, s) {
    this.setSubscriber(e2, { cb: s });
  }
  once(e2, s) {
    this.setSubscriber(e2, { cb: s, once: true });
  }
  emit(e2, ...s) {
    const i = this._subscribers.get(e2) ?? [], r = [];
    for (const n of i) n.cb(...s), n.once && r.push(() => i.splice(i.indexOf(n), 1));
    for (const n of r) n();
  }
  prompt() {
    return new Promise((e2) => {
      if (this._abortSignal) {
        if (this._abortSignal.aborted) return this.state = "cancel", this.close(), e2(z);
        this._abortSignal.addEventListener("abort", () => {
          this.state = "cancel", this.close();
        }, { once: true });
      }
      this.rl = ot.createInterface({ input: this.input, tabSize: 2, prompt: "", escapeCodeTimeout: 50, terminal: true }), this.rl.prompt(), this.opts.initialUserInput !== void 0 && this._setUserInput(this.opts.initialUserInput, true), this.input.on("keypress", this.onKeypress), T(this.input, true), this.output.on("resize", this.render), this.render(), this.once("submit", () => {
        this.output.write(import_sisteransi.cursor.show), this.output.off("resize", this.render), T(this.input, false), e2(this.value);
      }), this.once("cancel", () => {
        this.output.write(import_sisteransi.cursor.show), this.output.off("resize", this.render), T(this.input, false), e2(z);
      });
    });
  }
  _isActionKey(e2, s) {
    return e2 === "	";
  }
  _setValue(e2) {
    this.value = e2, this.emit("value", this.value);
  }
  _setUserInput(e2, s) {
    this.userInput = e2 ?? "", this.emit("userInput", this.userInput), s && this._track && this.rl && (this.rl.write(this.userInput), this._cursor = this.rl.cursor);
  }
  _clearUserInput() {
    this.rl?.write(null, { ctrl: true, name: "u" }), this._setUserInput("");
  }
  onKeypress(e2, s) {
    if (this._track && s.name !== "return" && (s.name && this._isActionKey(e2, s) && this.rl?.write(null, { ctrl: true, name: "h" }), this._cursor = this.rl?.cursor ?? 0, this._setUserInput(this.rl?.line)), this.state === "error" && (this.state = "active"), s?.name && (!this._track && _.aliases.has(s.name) && this.emit("cursor", _.aliases.get(s.name)), _.actions.has(s.name) && this.emit("cursor", s.name)), e2 && (e2.toLowerCase() === "y" || e2.toLowerCase() === "n") && this.emit("confirm", e2.toLowerCase() === "y"), this.emit("key", e2?.toLowerCase(), s), s?.name === "return") {
      if (this.opts.validate) {
        const i = this.opts.validate(this.value);
        i && (this.error = i instanceof Error ? i.message : i, this.state = "error", this.rl?.write(this.userInput));
      }
      this.state !== "error" && (this.state = "submit");
    }
    H([e2, s?.name, s?.sequence], "cancel") && (this.state = "cancel"), (this.state === "submit" || this.state === "cancel") && this.emit("finalize"), this.render(), (this.state === "submit" || this.state === "cancel") && this.close();
  }
  close() {
    this.input.unpipe(), this.input.removeListener("keypress", this.onKeypress), this.output.write(`
`), T(this.input, false), this.rl?.close(), this.rl = void 0, this.emit(`${this.state}`, this.value), this.unsubscribe();
  }
  restoreCursor() {
    const e2 = K(this._prevFrame, process.stdout.columns, { hard: true, trim: false }).split(`
`).length - 1;
    this.output.write(import_sisteransi.cursor.move(-999, e2 * -1));
  }
  render() {
    const e2 = K(this._render(this) ?? "", process.stdout.columns, { hard: true, trim: false });
    if (e2 !== this._prevFrame) {
      if (this.state === "initial") this.output.write(import_sisteransi.cursor.hide);
      else {
        const s = _t(this._prevFrame, e2), i = nt(this.output);
        if (this.restoreCursor(), s) {
          const r = Math.max(0, s.numLinesAfter - i), n = Math.max(0, s.numLinesBefore - i);
          let u = s.lines.find((a) => a >= r);
          if (u === void 0) {
            this._prevFrame = e2;
            return;
          }
          if (s.lines.length === 1) {
            this.output.write(import_sisteransi.cursor.move(0, u - n)), this.output.write(import_sisteransi.erase.lines(1));
            const a = e2.split(`
`);
            this.output.write(a[u]), this._prevFrame = e2, this.output.write(import_sisteransi.cursor.move(0, a.length - u - 1));
            return;
          } else if (s.lines.length > 1) {
            if (r < n) u = r;
            else {
              const l = u - n;
              l > 0 && this.output.write(import_sisteransi.cursor.move(0, l));
            }
            this.output.write(import_sisteransi.erase.down());
            const a = e2.split(`
`).slice(u);
            this.output.write(a.join(`
`)), this._prevFrame = e2;
            return;
          }
        }
        this.output.write(import_sisteransi.erase.down());
      }
      this.output.write(e2), this.state === "initial" && (this.state = "active"), this._prevFrame = e2;
    }
  }
};
var kt = class extends x {
  get cursor() {
    return this.value ? 0 : 1;
  }
  get _value() {
    return this.cursor === 0;
  }
  constructor(e2) {
    super(e2, false), this.value = !!e2.initialValue, this.on("userInput", () => {
      this.value = this._value;
    }), this.on("confirm", (s) => {
      this.output.write(import_sisteransi.cursor.move(0, -1)), this.value = s, this.state = "submit", this.close();
    }), this.on("cursor", () => {
      this.value = !this.value;
    });
  }
};
var Lt = class extends x {
  options;
  cursor = 0;
  get _value() {
    return this.options[this.cursor].value;
  }
  get _enabledOptions() {
    return this.options.filter((e2) => e2.disabled !== true);
  }
  toggleAll() {
    const e2 = this._enabledOptions, s = this.value !== void 0 && this.value.length === e2.length;
    this.value = s ? [] : e2.map((i) => i.value);
  }
  toggleInvert() {
    const e2 = this.value;
    if (!e2) return;
    const s = this._enabledOptions.filter((i) => !e2.includes(i.value));
    this.value = s.map((i) => i.value);
  }
  toggleValue() {
    this.value === void 0 && (this.value = []);
    const e2 = this.value.includes(this._value);
    this.value = e2 ? this.value.filter((s) => s !== this._value) : [...this.value, this._value];
  }
  constructor(e2) {
    super(e2, false), this.options = e2.options, this.value = [...e2.initialValues ?? []];
    const s = Math.max(this.options.findIndex(({ value: i }) => i === e2.cursorAt), 0);
    this.cursor = this.options[s].disabled ? B(s, 1, this.options) : s, this.on("key", (i) => {
      i === "a" && this.toggleAll(), i === "i" && this.toggleInvert();
    }), this.on("cursor", (i) => {
      switch (i) {
        case "left":
        case "up":
          this.cursor = B(this.cursor, -1, this.options);
          break;
        case "down":
        case "right":
          this.cursor = B(this.cursor, 1, this.options);
          break;
        case "space":
          this.toggleValue();
          break;
      }
    });
  }
};
var Mt = class extends x {
  _mask = "\u2022";
  get cursor() {
    return this._cursor;
  }
  get masked() {
    return this.userInput.replaceAll(/./g, this._mask);
  }
  get userInputWithCursor() {
    if (this.state === "submit" || this.state === "cancel") return this.masked;
    const e2 = this.userInput;
    if (this.cursor >= e2.length) return `${this.masked}${import_picocolors3.default.inverse(import_picocolors3.default.hidden("_"))}`;
    const s = this.masked, i = s.slice(0, this.cursor), r = s.slice(this.cursor);
    return `${i}${import_picocolors3.default.inverse(r[0])}${r.slice(1)}`;
  }
  clear() {
    this._clearUserInput();
  }
  constructor({ mask: e2, ...s }) {
    super(s), this._mask = e2 ?? "\u2022", this.on("userInput", (i) => {
      this._setValue(i);
    });
  }
};
var Wt = class extends x {
  options;
  cursor = 0;
  get _selectedValue() {
    return this.options[this.cursor];
  }
  changeValue() {
    this.value = this._selectedValue.value;
  }
  constructor(e2) {
    super(e2, false), this.options = e2.options;
    const s = this.options.findIndex(({ value: r }) => r === e2.initialValue), i = s === -1 ? 0 : s;
    this.cursor = this.options[i].disabled ? B(i, 1, this.options) : i, this.changeValue(), this.on("cursor", (r) => {
      switch (r) {
        case "left":
        case "up":
          this.cursor = B(this.cursor, -1, this.options);
          break;
        case "down":
        case "right":
          this.cursor = B(this.cursor, 1, this.options);
          break;
      }
      this.changeValue();
    });
  }
};
var $t = class extends x {
  get userInputWithCursor() {
    if (this.state === "submit") return this.userInput;
    const e2 = this.userInput;
    if (this.cursor >= e2.length) return `${this.userInput}\u2588`;
    const s = e2.slice(0, this.cursor), [i, ...r] = e2.slice(this.cursor);
    return `${s}${import_picocolors3.default.inverse(i)}${r.join("")}`;
  }
  get cursor() {
    return this._cursor;
  }
  constructor(e2) {
    super({ ...e2, initialUserInput: e2.initialUserInput ?? e2.initialValue }), this.on("userInput", (s) => {
      this._setValue(s);
    }), this.on("finalize", () => {
      this.value || (this.value = e2.defaultValue), this.value === void 0 && (this.value = "");
    });
  }
};

// node_modules/@clack/prompts/dist/index.mjs
var import_picocolors4 = __toESM(require_picocolors(), 1);
var import_sisteransi2 = __toESM(require_src(), 1);
import N2 from "process";
import { readdirSync as de, existsSync as $e, lstatSync as xt2 } from "fs";
import { dirname as _t2, join as he } from "path";
import { stripVTControlCharacters as ut } from "util";
function me() {
  return N2.platform !== "win32" ? N2.env.TERM !== "linux" : !!N2.env.CI || !!N2.env.WT_SESSION || !!N2.env.TERMINUS_SUBLIME || N2.env.ConEmuTask === "{cmd::Cmder}" || N2.env.TERM_PROGRAM === "Terminus-Sublime" || N2.env.TERM_PROGRAM === "vscode" || N2.env.TERM === "xterm-256color" || N2.env.TERM === "alacritty" || N2.env.TERMINAL_EMULATOR === "JetBrains-JediTerm";
}
var et2 = me();
var ct2 = () => process.env.CI === "true";
var C = (t, r) => et2 ? t : r;
var Rt = C("\u25C6", "*");
var dt2 = C("\u25A0", "x");
var $t2 = C("\u25B2", "x");
var V = C("\u25C7", "o");
var ht2 = C("\u250C", "T");
var d = C("\u2502", "|");
var x2 = C("\u2514", "\u2014");
var Ot = C("\u2510", "T");
var Pt = C("\u2518", "\u2014");
var Q2 = C("\u25CF", ">");
var H2 = C("\u25CB", " ");
var st2 = C("\u25FB", "[\u2022]");
var U2 = C("\u25FC", "[+]");
var q2 = C("\u25FB", "[ ]");
var Nt = C("\u25AA", "\u2022");
var rt2 = C("\u2500", "-");
var mt2 = C("\u256E", "+");
var Wt2 = C("\u251C", "+");
var pt2 = C("\u256F", "+");
var gt2 = C("\u2570", "+");
var Lt2 = C("\u256D", "+");
var ft2 = C("\u25CF", "\u2022");
var Ft2 = C("\u25C6", "*");
var yt2 = C("\u25B2", "!");
var Et2 = C("\u25A0", "x");
var W2 = (t) => {
  switch (t) {
    case "initial":
    case "active":
      return import_picocolors4.default.cyan(Rt);
    case "cancel":
      return import_picocolors4.default.red(dt2);
    case "error":
      return import_picocolors4.default.yellow($t2);
    case "submit":
      return import_picocolors4.default.green(V);
  }
};
var vt2 = (t) => {
  switch (t) {
    case "initial":
    case "active":
      return import_picocolors4.default.cyan(d);
    case "cancel":
      return import_picocolors4.default.red(d);
    case "error":
      return import_picocolors4.default.yellow(d);
    case "submit":
      return import_picocolors4.default.green(d);
  }
};
var pe = (t) => t === 161 || t === 164 || t === 167 || t === 168 || t === 170 || t === 173 || t === 174 || t >= 176 && t <= 180 || t >= 182 && t <= 186 || t >= 188 && t <= 191 || t === 198 || t === 208 || t === 215 || t === 216 || t >= 222 && t <= 225 || t === 230 || t >= 232 && t <= 234 || t === 236 || t === 237 || t === 240 || t === 242 || t === 243 || t >= 247 && t <= 250 || t === 252 || t === 254 || t === 257 || t === 273 || t === 275 || t === 283 || t === 294 || t === 295 || t === 299 || t >= 305 && t <= 307 || t === 312 || t >= 319 && t <= 322 || t === 324 || t >= 328 && t <= 331 || t === 333 || t === 338 || t === 339 || t === 358 || t === 359 || t === 363 || t === 462 || t === 464 || t === 466 || t === 468 || t === 470 || t === 472 || t === 474 || t === 476 || t === 593 || t === 609 || t === 708 || t === 711 || t >= 713 && t <= 715 || t === 717 || t === 720 || t >= 728 && t <= 731 || t === 733 || t === 735 || t >= 768 && t <= 879 || t >= 913 && t <= 929 || t >= 931 && t <= 937 || t >= 945 && t <= 961 || t >= 963 && t <= 969 || t === 1025 || t >= 1040 && t <= 1103 || t === 1105 || t === 8208 || t >= 8211 && t <= 8214 || t === 8216 || t === 8217 || t === 8220 || t === 8221 || t >= 8224 && t <= 8226 || t >= 8228 && t <= 8231 || t === 8240 || t === 8242 || t === 8243 || t === 8245 || t === 8251 || t === 8254 || t === 8308 || t === 8319 || t >= 8321 && t <= 8324 || t === 8364 || t === 8451 || t === 8453 || t === 8457 || t === 8467 || t === 8470 || t === 8481 || t === 8482 || t === 8486 || t === 8491 || t === 8531 || t === 8532 || t >= 8539 && t <= 8542 || t >= 8544 && t <= 8555 || t >= 8560 && t <= 8569 || t === 8585 || t >= 8592 && t <= 8601 || t === 8632 || t === 8633 || t === 8658 || t === 8660 || t === 8679 || t === 8704 || t === 8706 || t === 8707 || t === 8711 || t === 8712 || t === 8715 || t === 8719 || t === 8721 || t === 8725 || t === 8730 || t >= 8733 && t <= 8736 || t === 8739 || t === 8741 || t >= 8743 && t <= 8748 || t === 8750 || t >= 8756 && t <= 8759 || t === 8764 || t === 8765 || t === 8776 || t === 8780 || t === 8786 || t === 8800 || t === 8801 || t >= 8804 && t <= 8807 || t === 8810 || t === 8811 || t === 8814 || t === 8815 || t === 8834 || t === 8835 || t === 8838 || t === 8839 || t === 8853 || t === 8857 || t === 8869 || t === 8895 || t === 8978 || t >= 9312 && t <= 9449 || t >= 9451 && t <= 9547 || t >= 9552 && t <= 9587 || t >= 9600 && t <= 9615 || t >= 9618 && t <= 9621 || t === 9632 || t === 9633 || t >= 9635 && t <= 9641 || t === 9650 || t === 9651 || t === 9654 || t === 9655 || t === 9660 || t === 9661 || t === 9664 || t === 9665 || t >= 9670 && t <= 9672 || t === 9675 || t >= 9678 && t <= 9681 || t >= 9698 && t <= 9701 || t === 9711 || t === 9733 || t === 9734 || t === 9737 || t === 9742 || t === 9743 || t === 9756 || t === 9758 || t === 9792 || t === 9794 || t === 9824 || t === 9825 || t >= 9827 && t <= 9829 || t >= 9831 && t <= 9834 || t === 9836 || t === 9837 || t === 9839 || t === 9886 || t === 9887 || t === 9919 || t >= 9926 && t <= 9933 || t >= 9935 && t <= 9939 || t >= 9941 && t <= 9953 || t === 9955 || t === 9960 || t === 9961 || t >= 9963 && t <= 9969 || t === 9972 || t >= 9974 && t <= 9977 || t === 9979 || t === 9980 || t === 9982 || t === 9983 || t === 10045 || t >= 10102 && t <= 10111 || t >= 11094 && t <= 11097 || t >= 12872 && t <= 12879 || t >= 57344 && t <= 63743 || t >= 65024 && t <= 65039 || t === 65533 || t >= 127232 && t <= 127242 || t >= 127248 && t <= 127277 || t >= 127280 && t <= 127337 || t >= 127344 && t <= 127373 || t === 127375 || t === 127376 || t >= 127387 && t <= 127404 || t >= 917760 && t <= 917999 || t >= 983040 && t <= 1048573 || t >= 1048576 && t <= 1114109;
var ge = (t) => t === 12288 || t >= 65281 && t <= 65376 || t >= 65504 && t <= 65510;
var fe = (t) => t >= 4352 && t <= 4447 || t === 8986 || t === 8987 || t === 9001 || t === 9002 || t >= 9193 && t <= 9196 || t === 9200 || t === 9203 || t === 9725 || t === 9726 || t === 9748 || t === 9749 || t >= 9800 && t <= 9811 || t === 9855 || t === 9875 || t === 9889 || t === 9898 || t === 9899 || t === 9917 || t === 9918 || t === 9924 || t === 9925 || t === 9934 || t === 9940 || t === 9962 || t === 9970 || t === 9971 || t === 9973 || t === 9978 || t === 9981 || t === 9989 || t === 9994 || t === 9995 || t === 10024 || t === 10060 || t === 10062 || t >= 10067 && t <= 10069 || t === 10071 || t >= 10133 && t <= 10135 || t === 10160 || t === 10175 || t === 11035 || t === 11036 || t === 11088 || t === 11093 || t >= 11904 && t <= 11929 || t >= 11931 && t <= 12019 || t >= 12032 && t <= 12245 || t >= 12272 && t <= 12287 || t >= 12289 && t <= 12350 || t >= 12353 && t <= 12438 || t >= 12441 && t <= 12543 || t >= 12549 && t <= 12591 || t >= 12593 && t <= 12686 || t >= 12688 && t <= 12771 || t >= 12783 && t <= 12830 || t >= 12832 && t <= 12871 || t >= 12880 && t <= 19903 || t >= 19968 && t <= 42124 || t >= 42128 && t <= 42182 || t >= 43360 && t <= 43388 || t >= 44032 && t <= 55203 || t >= 63744 && t <= 64255 || t >= 65040 && t <= 65049 || t >= 65072 && t <= 65106 || t >= 65108 && t <= 65126 || t >= 65128 && t <= 65131 || t >= 94176 && t <= 94180 || t === 94192 || t === 94193 || t >= 94208 && t <= 100343 || t >= 100352 && t <= 101589 || t >= 101632 && t <= 101640 || t >= 110576 && t <= 110579 || t >= 110581 && t <= 110587 || t === 110589 || t === 110590 || t >= 110592 && t <= 110882 || t === 110898 || t >= 110928 && t <= 110930 || t === 110933 || t >= 110948 && t <= 110951 || t >= 110960 && t <= 111355 || t === 126980 || t === 127183 || t === 127374 || t >= 127377 && t <= 127386 || t >= 127488 && t <= 127490 || t >= 127504 && t <= 127547 || t >= 127552 && t <= 127560 || t === 127568 || t === 127569 || t >= 127584 && t <= 127589 || t >= 127744 && t <= 127776 || t >= 127789 && t <= 127797 || t >= 127799 && t <= 127868 || t >= 127870 && t <= 127891 || t >= 127904 && t <= 127946 || t >= 127951 && t <= 127955 || t >= 127968 && t <= 127984 || t === 127988 || t >= 127992 && t <= 128062 || t === 128064 || t >= 128066 && t <= 128252 || t >= 128255 && t <= 128317 || t >= 128331 && t <= 128334 || t >= 128336 && t <= 128359 || t === 128378 || t === 128405 || t === 128406 || t === 128420 || t >= 128507 && t <= 128591 || t >= 128640 && t <= 128709 || t === 128716 || t >= 128720 && t <= 128722 || t >= 128725 && t <= 128727 || t >= 128732 && t <= 128735 || t === 128747 || t === 128748 || t >= 128756 && t <= 128764 || t >= 128992 && t <= 129003 || t === 129008 || t >= 129292 && t <= 129338 || t >= 129340 && t <= 129349 || t >= 129351 && t <= 129535 || t >= 129648 && t <= 129660 || t >= 129664 && t <= 129672 || t >= 129680 && t <= 129725 || t >= 129727 && t <= 129733 || t >= 129742 && t <= 129755 || t >= 129760 && t <= 129768 || t >= 129776 && t <= 129784 || t >= 131072 && t <= 196605 || t >= 196608 && t <= 262141;
var At2 = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/y;
var it2 = /[\x00-\x08\x0A-\x1F\x7F-\x9F]{1,1000}/y;
var nt2 = /\t{1,1000}/y;
var wt = new RegExp("[\\u{1F1E6}-\\u{1F1FF}]{2}|\\u{1F3F4}[\\u{E0061}-\\u{E007A}]{2}[\\u{E0030}-\\u{E0039}\\u{E0061}-\\u{E007A}]{1,3}\\u{E007F}|(?:\\p{Emoji}\\uFE0F\\u20E3?|\\p{Emoji_Modifier_Base}\\p{Emoji_Modifier}?|\\p{Emoji_Presentation})(?:\\u200D(?:\\p{Emoji_Modifier_Base}\\p{Emoji_Modifier}?|\\p{Emoji_Presentation}|\\p{Emoji}\\uFE0F\\u20E3?))*", "yu");
var at2 = /(?:[\x20-\x7E\xA0-\xFF](?!\uFE0F)){1,1000}/y;
var Fe = new RegExp("\\p{M}+", "gu");
var ye = { limit: 1 / 0, ellipsis: "" };
var jt = (t, r = {}, s = {}) => {
  const i = r.limit ?? 1 / 0, a = r.ellipsis ?? "", o = r?.ellipsisWidth ?? (a ? jt(a, ye, s).width : 0), u = s.ansiWidth ?? 0, l = s.controlWidth ?? 0, n = s.tabWidth ?? 8, c = s.ambiguousWidth ?? 1, g = s.emojiWidth ?? 2, F = s.fullWidthWidth ?? 2, p = s.regularWidth ?? 1, E = s.wideWidth ?? 2;
  let $ = 0, m = 0, h = t.length, y2 = 0, f = false, v = h, S2 = Math.max(0, i - o), I2 = 0, B2 = 0, A = 0, w = 0;
  t: for (; ; ) {
    if (B2 > I2 || m >= h && m > $) {
      const _2 = t.slice(I2, B2) || t.slice($, m);
      y2 = 0;
      for (const D2 of _2.replaceAll(Fe, "")) {
        const T2 = D2.codePointAt(0) || 0;
        if (ge(T2) ? w = F : fe(T2) ? w = E : c !== p && pe(T2) ? w = c : w = p, A + w > S2 && (v = Math.min(v, Math.max(I2, $) + y2)), A + w > i) {
          f = true;
          break t;
        }
        y2 += D2.length, A += w;
      }
      I2 = B2 = 0;
    }
    if (m >= h) break;
    if (at2.lastIndex = m, at2.test(t)) {
      if (y2 = at2.lastIndex - m, w = y2 * p, A + w > S2 && (v = Math.min(v, m + Math.floor((S2 - A) / p))), A + w > i) {
        f = true;
        break;
      }
      A += w, I2 = $, B2 = m, m = $ = at2.lastIndex;
      continue;
    }
    if (At2.lastIndex = m, At2.test(t)) {
      if (A + u > S2 && (v = Math.min(v, m)), A + u > i) {
        f = true;
        break;
      }
      A += u, I2 = $, B2 = m, m = $ = At2.lastIndex;
      continue;
    }
    if (it2.lastIndex = m, it2.test(t)) {
      if (y2 = it2.lastIndex - m, w = y2 * l, A + w > S2 && (v = Math.min(v, m + Math.floor((S2 - A) / l))), A + w > i) {
        f = true;
        break;
      }
      A += w, I2 = $, B2 = m, m = $ = it2.lastIndex;
      continue;
    }
    if (nt2.lastIndex = m, nt2.test(t)) {
      if (y2 = nt2.lastIndex - m, w = y2 * n, A + w > S2 && (v = Math.min(v, m + Math.floor((S2 - A) / n))), A + w > i) {
        f = true;
        break;
      }
      A += w, I2 = $, B2 = m, m = $ = nt2.lastIndex;
      continue;
    }
    if (wt.lastIndex = m, wt.test(t)) {
      if (A + g > S2 && (v = Math.min(v, m)), A + g > i) {
        f = true;
        break;
      }
      A += g, I2 = $, B2 = m, m = $ = wt.lastIndex;
      continue;
    }
    m += 1;
  }
  return { width: f ? S2 : A, index: f ? v : h, truncated: f, ellipsed: f && i >= o };
};
var Ee = { limit: 1 / 0, ellipsis: "", ellipsisWidth: 0 };
var M2 = (t, r = {}) => jt(t, Ee, r).width;
var ot2 = "\x1B";
var Gt = "\x9B";
var ve = 39;
var Ct2 = "\x07";
var kt2 = "[";
var Ae = "]";
var Vt2 = "m";
var St = `${Ae}8;;`;
var Ht = new RegExp(`(?:\\${kt2}(?<code>\\d+)m|\\${St}(?<uri>.*)${Ct2})`, "y");
var we = (t) => {
  if (t >= 30 && t <= 37 || t >= 90 && t <= 97) return 39;
  if (t >= 40 && t <= 47 || t >= 100 && t <= 107) return 49;
  if (t === 1 || t === 2) return 22;
  if (t === 3) return 23;
  if (t === 4) return 24;
  if (t === 7) return 27;
  if (t === 8) return 28;
  if (t === 9) return 29;
  if (t === 0) return 0;
};
var Ut = (t) => `${ot2}${kt2}${t}${Vt2}`;
var Kt = (t) => `${ot2}${St}${t}${Ct2}`;
var Ce = (t) => t.map((r) => M2(r));
var It2 = (t, r, s) => {
  const i = r[Symbol.iterator]();
  let a = false, o = false, u = t.at(-1), l = u === void 0 ? 0 : M2(u), n = i.next(), c = i.next(), g = 0;
  for (; !n.done; ) {
    const F = n.value, p = M2(F);
    l + p <= s ? t[t.length - 1] += F : (t.push(F), l = 0), (F === ot2 || F === Gt) && (a = true, o = r.startsWith(St, g + 1)), a ? o ? F === Ct2 && (a = false, o = false) : F === Vt2 && (a = false) : (l += p, l === s && !c.done && (t.push(""), l = 0)), n = c, c = i.next(), g += F.length;
  }
  u = t.at(-1), !l && u !== void 0 && u.length > 0 && t.length > 1 && (t[t.length - 2] += t.pop());
};
var Se = (t) => {
  const r = t.split(" ");
  let s = r.length;
  for (; s > 0 && !(M2(r[s - 1]) > 0); ) s--;
  return s === r.length ? t : r.slice(0, s).join(" ") + r.slice(s).join("");
};
var Ie = (t, r, s = {}) => {
  if (s.trim !== false && t.trim() === "") return "";
  let i = "", a, o;
  const u = t.split(" "), l = Ce(u);
  let n = [""];
  for (const [$, m] of u.entries()) {
    s.trim !== false && (n[n.length - 1] = (n.at(-1) ?? "").trimStart());
    let h = M2(n.at(-1) ?? "");
    if ($ !== 0 && (h >= r && (s.wordWrap === false || s.trim === false) && (n.push(""), h = 0), (h > 0 || s.trim === false) && (n[n.length - 1] += " ", h++)), s.hard && l[$] > r) {
      const y2 = r - h, f = 1 + Math.floor((l[$] - y2 - 1) / r);
      Math.floor((l[$] - 1) / r) < f && n.push(""), It2(n, m, r);
      continue;
    }
    if (h + l[$] > r && h > 0 && l[$] > 0) {
      if (s.wordWrap === false && h < r) {
        It2(n, m, r);
        continue;
      }
      n.push("");
    }
    if (h + l[$] > r && s.wordWrap === false) {
      It2(n, m, r);
      continue;
    }
    n[n.length - 1] += m;
  }
  s.trim !== false && (n = n.map(($) => Se($)));
  const c = n.join(`
`), g = c[Symbol.iterator]();
  let F = g.next(), p = g.next(), E = 0;
  for (; !F.done; ) {
    const $ = F.value, m = p.value;
    if (i += $, $ === ot2 || $ === Gt) {
      Ht.lastIndex = E + 1;
      const f = Ht.exec(c)?.groups;
      if (f?.code !== void 0) {
        const v = Number.parseFloat(f.code);
        a = v === ve ? void 0 : v;
      } else f?.uri !== void 0 && (o = f.uri.length === 0 ? void 0 : f.uri);
    }
    const h = a ? we(a) : void 0;
    m === `
` ? (o && (i += Kt("")), a && h && (i += Ut(h))) : $ === `
` && (a && h && (i += Ut(a)), o && (i += Kt(o))), E += $.length, F = p, p = g.next();
  }
  return i;
};
function J2(t, r, s) {
  return String(t).normalize().replaceAll(`\r
`, `
`).split(`
`).map((i) => Ie(i, r, s)).join(`
`);
}
var be = (t, r, s, i, a) => {
  let o = r, u = 0;
  for (let l = s; l < i; l++) {
    const n = t[l];
    if (o = o - n.length, u++, o <= a) break;
  }
  return { lineCount: o, removals: u };
};
var X2 = (t) => {
  const { cursor: r, options: s, style: i } = t, a = t.output ?? process.stdout, o = rt(a), u = t.columnPadding ?? 0, l = t.rowPadding ?? 4, n = o - u, c = nt(a), g = import_picocolors4.default.dim("..."), F = t.maxItems ?? Number.POSITIVE_INFINITY, p = Math.max(c - l, 0), E = Math.max(Math.min(F, p), 5);
  let $ = 0;
  r >= E - 3 && ($ = Math.max(Math.min(r - E + 3, s.length - E), 0));
  let m = E < s.length && $ > 0, h = E < s.length && $ + E < s.length;
  const y2 = Math.min($ + E, s.length), f = [];
  let v = 0;
  m && v++, h && v++;
  const S2 = $ + (m ? 1 : 0), I2 = y2 - (h ? 1 : 0);
  for (let A = S2; A < I2; A++) {
    const w = J2(i(s[A], A === r), n, { hard: true, trim: false }).split(`
`);
    f.push(w), v += w.length;
  }
  if (v > p) {
    let A = 0, w = 0, _2 = v;
    const D2 = r - S2, T2 = (Y, L2) => be(f, _2, Y, L2, p);
    m ? ({ lineCount: _2, removals: A } = T2(0, D2), _2 > p && ({ lineCount: _2, removals: w } = T2(D2 + 1, f.length))) : ({ lineCount: _2, removals: w } = T2(D2 + 1, f.length), _2 > p && ({ lineCount: _2, removals: A } = T2(0, D2))), A > 0 && (m = true, f.splice(0, A)), w > 0 && (h = true, f.splice(f.length - w, w));
  }
  const B2 = [];
  m && B2.push(g);
  for (const A of f) for (const w of A) B2.push(w);
  return h && B2.push(g), B2;
};
var Re = (t) => {
  const r = t.active ?? "Yes", s = t.inactive ?? "No";
  return new kt({ active: r, inactive: s, signal: t.signal, input: t.input, output: t.output, initialValue: t.initialValue ?? true, render() {
    const i = t.withGuide ?? _.withGuide, a = `${i ? `${import_picocolors4.default.gray(d)}
` : ""}${W2(this.state)}  ${t.message}
`, o = this.value ? r : s;
    switch (this.state) {
      case "submit": {
        const u = i ? `${import_picocolors4.default.gray(d)}  ` : "";
        return `${a}${u}${import_picocolors4.default.dim(o)}`;
      }
      case "cancel": {
        const u = i ? `${import_picocolors4.default.gray(d)}  ` : "";
        return `${a}${u}${import_picocolors4.default.strikethrough(import_picocolors4.default.dim(o))}${i ? `
${import_picocolors4.default.gray(d)}` : ""}`;
      }
      default: {
        const u = i ? `${import_picocolors4.default.cyan(d)}  ` : "", l = i ? import_picocolors4.default.cyan(x2) : "";
        return `${a}${u}${this.value ? `${import_picocolors4.default.green(Q2)} ${r}` : `${import_picocolors4.default.dim(H2)} ${import_picocolors4.default.dim(r)}`}${t.vertical ? i ? `
${import_picocolors4.default.cyan(d)}  ` : `
` : ` ${import_picocolors4.default.dim("/")} `}${this.value ? `${import_picocolors4.default.dim(H2)} ${import_picocolors4.default.dim(s)}` : `${import_picocolors4.default.green(Q2)} ${s}`}
${l}
`;
      }
    }
  } }).prompt();
};
var R2 = { message: (t = [], { symbol: r = import_picocolors4.default.gray(d), secondarySymbol: s = import_picocolors4.default.gray(d), output: i = process.stdout, spacing: a = 1, withGuide: o } = {}) => {
  const u = [], l = o ?? _.withGuide, n = l ? s : "", c = l ? `${r}  ` : "", g = l ? `${s}  ` : "";
  for (let p = 0; p < a; p++) u.push(n);
  const F = Array.isArray(t) ? t : t.split(`
`);
  if (F.length > 0) {
    const [p, ...E] = F;
    p.length > 0 ? u.push(`${c}${p}`) : u.push(l ? r : "");
    for (const $ of E) $.length > 0 ? u.push(`${g}${$}`) : u.push(l ? s : "");
  }
  i.write(`${u.join(`
`)}
`);
}, info: (t, r) => {
  R2.message(t, { ...r, symbol: import_picocolors4.default.blue(ft2) });
}, success: (t, r) => {
  R2.message(t, { ...r, symbol: import_picocolors4.default.green(Ft2) });
}, step: (t, r) => {
  R2.message(t, { ...r, symbol: import_picocolors4.default.green(V) });
}, warn: (t, r) => {
  R2.message(t, { ...r, symbol: import_picocolors4.default.yellow(yt2) });
}, warning: (t, r) => {
  R2.warn(t, r);
}, error: (t, r) => {
  R2.message(t, { ...r, symbol: import_picocolors4.default.red(Et2) });
} };
var Ne = (t = "", r) => {
  (r?.output ?? process.stdout).write(`${import_picocolors4.default.gray(x2)}  ${import_picocolors4.default.red(t)}

`);
};
var We = (t = "", r) => {
  (r?.output ?? process.stdout).write(`${import_picocolors4.default.gray(ht2)}  ${t}
`);
};
var Le = (t = "", r) => {
  (r?.output ?? process.stdout).write(`${import_picocolors4.default.gray(d)}
${import_picocolors4.default.gray(x2)}  ${t}

`);
};
var Z2 = (t, r) => t.split(`
`).map((s) => r(s)).join(`
`);
var je = (t) => {
  const r = (i, a) => {
    const o = i.label ?? String(i.value);
    return a === "disabled" ? `${import_picocolors4.default.gray(q2)} ${Z2(o, (u) => import_picocolors4.default.strikethrough(import_picocolors4.default.gray(u)))}${i.hint ? ` ${import_picocolors4.default.dim(`(${i.hint ?? "disabled"})`)}` : ""}` : a === "active" ? `${import_picocolors4.default.cyan(st2)} ${o}${i.hint ? ` ${import_picocolors4.default.dim(`(${i.hint})`)}` : ""}` : a === "selected" ? `${import_picocolors4.default.green(U2)} ${Z2(o, import_picocolors4.default.dim)}${i.hint ? ` ${import_picocolors4.default.dim(`(${i.hint})`)}` : ""}` : a === "cancelled" ? `${Z2(o, (u) => import_picocolors4.default.strikethrough(import_picocolors4.default.dim(u)))}` : a === "active-selected" ? `${import_picocolors4.default.green(U2)} ${o}${i.hint ? ` ${import_picocolors4.default.dim(`(${i.hint})`)}` : ""}` : a === "submitted" ? `${Z2(o, import_picocolors4.default.dim)}` : `${import_picocolors4.default.dim(q2)} ${Z2(o, import_picocolors4.default.dim)}`;
  }, s = t.required ?? true;
  return new Lt({ options: t.options, signal: t.signal, input: t.input, output: t.output, initialValues: t.initialValues, required: s, cursorAt: t.cursorAt, validate(i) {
    if (s && (i === void 0 || i.length === 0)) return `Please select at least one option.
${import_picocolors4.default.reset(import_picocolors4.default.dim(`Press ${import_picocolors4.default.gray(import_picocolors4.default.bgWhite(import_picocolors4.default.inverse(" space ")))} to select, ${import_picocolors4.default.gray(import_picocolors4.default.bgWhite(import_picocolors4.default.inverse(" enter ")))} to submit`))}`;
  }, render() {
    const i = xt(t.output, t.message, `${vt2(this.state)}  `, `${W2(this.state)}  `), a = `${import_picocolors4.default.gray(d)}
${i}
`, o = this.value ?? [], u = (l, n) => {
      if (l.disabled) return r(l, "disabled");
      const c = o.includes(l.value);
      return n && c ? r(l, "active-selected") : c ? r(l, "selected") : r(l, n ? "active" : "inactive");
    };
    switch (this.state) {
      case "submit": {
        const l = this.options.filter(({ value: c }) => o.includes(c)).map((c) => r(c, "submitted")).join(import_picocolors4.default.dim(", ")) || import_picocolors4.default.dim("none"), n = xt(t.output, l, `${import_picocolors4.default.gray(d)}  `);
        return `${a}${n}`;
      }
      case "cancel": {
        const l = this.options.filter(({ value: c }) => o.includes(c)).map((c) => r(c, "cancelled")).join(import_picocolors4.default.dim(", "));
        if (l.trim() === "") return `${a}${import_picocolors4.default.gray(d)}`;
        const n = xt(t.output, l, `${import_picocolors4.default.gray(d)}  `);
        return `${a}${n}
${import_picocolors4.default.gray(d)}`;
      }
      case "error": {
        const l = `${import_picocolors4.default.yellow(d)}  `, n = this.error.split(`
`).map((F, p) => p === 0 ? `${import_picocolors4.default.yellow(x2)}  ${import_picocolors4.default.yellow(F)}` : `   ${F}`).join(`
`), c = a.split(`
`).length, g = n.split(`
`).length + 1;
        return `${a}${l}${X2({ output: t.output, options: this.options, cursor: this.cursor, maxItems: t.maxItems, columnPadding: l.length, rowPadding: c + g, style: u }).join(`
${l}`)}
${n}
`;
      }
      default: {
        const l = `${import_picocolors4.default.cyan(d)}  `, n = a.split(`
`).length;
        return `${a}${l}${X2({ output: t.output, options: this.options, cursor: this.cursor, maxItems: t.maxItems, columnPadding: l.length, rowPadding: n + 2, style: u }).join(`
${l}`)}
${import_picocolors4.default.cyan(x2)}
`;
      }
    }
  } }).prompt();
};
var He = (t) => new Mt({ validate: t.validate, mask: t.mask ?? Nt, signal: t.signal, input: t.input, output: t.output, render() {
  const r = t.withGuide ?? _.withGuide, s = `${r ? `${import_picocolors4.default.gray(d)}
` : ""}${W2(this.state)}  ${t.message}
`, i = this.userInputWithCursor, a = this.masked;
  switch (this.state) {
    case "error": {
      const o = r ? `${import_picocolors4.default.yellow(d)}  ` : "", u = r ? `${import_picocolors4.default.yellow(x2)}  ` : "", l = a ?? "";
      return t.clearOnError && this.clear(), `${s.trim()}
${o}${l}
${u}${import_picocolors4.default.yellow(this.error)}
`;
    }
    case "submit": {
      const o = r ? `${import_picocolors4.default.gray(d)}  ` : "", u = a ? import_picocolors4.default.dim(a) : "";
      return `${s}${o}${u}`;
    }
    case "cancel": {
      const o = r ? `${import_picocolors4.default.gray(d)}  ` : "", u = a ? import_picocolors4.default.strikethrough(import_picocolors4.default.dim(a)) : "";
      return `${s}${o}${u}${a && r ? `
${import_picocolors4.default.gray(d)}` : ""}`;
    }
    default: {
      const o = r ? `${import_picocolors4.default.cyan(d)}  ` : "", u = r ? import_picocolors4.default.cyan(x2) : "";
      return `${s}${o}${i}
${u}
`;
    }
  }
} }).prompt();
var Ke = import_picocolors4.default.magenta;
var bt2 = ({ indicator: t = "dots", onCancel: r, output: s = process.stdout, cancelMessage: i, errorMessage: a, frames: o = et2 ? ["\u25D2", "\u25D0", "\u25D3", "\u25D1"] : ["\u2022", "o", "O", "0"], delay: u = et2 ? 80 : 120, signal: l, ...n } = {}) => {
  const c = ct2();
  let g, F, p = false, E = false, $ = "", m, h = performance.now();
  const y2 = rt(s), f = n?.styleFrame ?? Ke, v = (b) => {
    const O2 = b > 1 ? a ?? _.messages.error : i ?? _.messages.cancel;
    E = b === 1, p && (L2(O2, b), E && typeof r == "function" && r());
  }, S2 = () => v(2), I2 = () => v(1), B2 = () => {
    process.on("uncaughtExceptionMonitor", S2), process.on("unhandledRejection", S2), process.on("SIGINT", I2), process.on("SIGTERM", I2), process.on("exit", v), l && l.addEventListener("abort", I2);
  }, A = () => {
    process.removeListener("uncaughtExceptionMonitor", S2), process.removeListener("unhandledRejection", S2), process.removeListener("SIGINT", I2), process.removeListener("SIGTERM", I2), process.removeListener("exit", v), l && l.removeEventListener("abort", I2);
  }, w = () => {
    if (m === void 0) return;
    c && s.write(`
`);
    const b = J2(m, y2, { hard: true, trim: false }).split(`
`);
    b.length > 1 && s.write(import_sisteransi2.cursor.up(b.length - 1)), s.write(import_sisteransi2.cursor.to(0)), s.write(import_sisteransi2.erase.down());
  }, _2 = (b) => b.replace(/\.+$/, ""), D2 = (b) => {
    const O2 = (performance.now() - b) / 1e3, j2 = Math.floor(O2 / 60), G2 = Math.floor(O2 % 60);
    return j2 > 0 ? `[${j2}m ${G2}s]` : `[${G2}s]`;
  }, T2 = n.withGuide ?? _.withGuide, Y = (b = "") => {
    p = true, g = Bt({ output: s }), $ = _2(b), h = performance.now(), T2 && s.write(`${import_picocolors4.default.gray(d)}
`);
    let O2 = 0, j2 = 0;
    B2(), F = setInterval(() => {
      if (c && $ === m) return;
      w(), m = $;
      const G2 = f(o[O2]);
      let tt2;
      if (c) tt2 = `${G2}  ${$}...`;
      else if (t === "timer") tt2 = `${G2}  ${$} ${D2(h)}`;
      else {
        const te = ".".repeat(Math.floor(j2)).slice(0, 3);
        tt2 = `${G2}  ${$}${te}`;
      }
      const Zt = J2(tt2, y2, { hard: true, trim: false });
      s.write(Zt), O2 = O2 + 1 < o.length ? O2 + 1 : 0, j2 = j2 < 4 ? j2 + 0.125 : 0;
    }, u);
  }, L2 = (b = "", O2 = 0, j2 = false) => {
    if (!p) return;
    p = false, clearInterval(F), w();
    const G2 = O2 === 0 ? import_picocolors4.default.green(V) : O2 === 1 ? import_picocolors4.default.red(dt2) : import_picocolors4.default.red($t2);
    $ = b ?? $, j2 || (t === "timer" ? s.write(`${G2}  ${$} ${D2(h)}
`) : s.write(`${G2}  ${$}
`)), A(), g();
  };
  return { start: Y, stop: (b = "") => L2(b, 0), message: (b = "") => {
    $ = _2(b ?? $);
  }, cancel: (b = "") => L2(b, 1), error: (b = "") => L2(b, 2), clear: () => L2("", 0, true), get isCancelled() {
    return E;
  } };
};
var zt = { light: C("\u2500", "-"), heavy: C("\u2501", "="), block: C("\u2588", "#") };
var lt2 = (t, r) => t.includes(`
`) ? t.split(`
`).map((s) => r(s)).join(`
`) : r(t);
var Je = (t) => {
  const r = (s, i) => {
    const a = s.label ?? String(s.value);
    switch (i) {
      case "disabled":
        return `${import_picocolors4.default.gray(H2)} ${lt2(a, import_picocolors4.default.gray)}${s.hint ? ` ${import_picocolors4.default.dim(`(${s.hint ?? "disabled"})`)}` : ""}`;
      case "selected":
        return `${lt2(a, import_picocolors4.default.dim)}`;
      case "active":
        return `${import_picocolors4.default.green(Q2)} ${a}${s.hint ? ` ${import_picocolors4.default.dim(`(${s.hint})`)}` : ""}`;
      case "cancelled":
        return `${lt2(a, (o) => import_picocolors4.default.strikethrough(import_picocolors4.default.dim(o)))}`;
      default:
        return `${import_picocolors4.default.dim(H2)} ${lt2(a, import_picocolors4.default.dim)}`;
    }
  };
  return new Wt({ options: t.options, signal: t.signal, input: t.input, output: t.output, initialValue: t.initialValue, render() {
    const s = t.withGuide ?? _.withGuide, i = `${W2(this.state)}  `, a = `${vt2(this.state)}  `, o = xt(t.output, t.message, a, i), u = `${s ? `${import_picocolors4.default.gray(d)}
` : ""}${o}
`;
    switch (this.state) {
      case "submit": {
        const l = s ? `${import_picocolors4.default.gray(d)}  ` : "", n = xt(t.output, r(this.options[this.cursor], "selected"), l);
        return `${u}${n}`;
      }
      case "cancel": {
        const l = s ? `${import_picocolors4.default.gray(d)}  ` : "", n = xt(t.output, r(this.options[this.cursor], "cancelled"), l);
        return `${u}${n}${s ? `
${import_picocolors4.default.gray(d)}` : ""}`;
      }
      default: {
        const l = s ? `${import_picocolors4.default.cyan(d)}  ` : "", n = s ? import_picocolors4.default.cyan(x2) : "", c = u.split(`
`).length, g = s ? 2 : 1;
        return `${u}${l}${X2({ output: t.output, cursor: this.cursor, options: this.options, maxItems: t.maxItems, columnPadding: l.length, rowPadding: c + g, style: (F, p) => r(F, F.disabled ? "disabled" : p ? "active" : "inactive") }).join(`
${l}`)}
${n}
`;
      }
    }
  } }).prompt();
};
var Qt = `${import_picocolors4.default.gray(d)}  `;

// src/utils/prompt.ts
var import_picocolors5 = __toESM(require_picocolors(), 1);
function text(opts) {
  const fillValue = opts.defaultValue ?? opts.placeholder;
  const prompt = new $t({
    placeholder: opts.placeholder,
    defaultValue: opts.defaultValue,
    initialValue: opts.initialValue,
    validate: opts.validate ? (value) => {
      const effective = value || opts.defaultValue || "";
      return opts.validate(effective);
    } : void 0,
    render() {
      const withGuide = _.withGuide;
      const head = `${withGuide ? `${import_picocolors5.default.gray(d)}
` : ""}${W2(this.state)}  ${opts.message}
`;
      const placeholderDisplay = opts.placeholder ? import_picocolors5.default.inverse(opts.placeholder[0]) + import_picocolors5.default.dim(opts.placeholder.slice(1)) : import_picocolors5.default.inverse(import_picocolors5.default.hidden("_"));
      const input = this.userInput ? this.userInputWithCursor : placeholderDisplay;
      const value = this.value ?? "";
      switch (this.state) {
        case "error": {
          const errorMsg = this.error ? `  ${import_picocolors5.default.yellow(this.error)}` : "";
          const bar = withGuide ? `${import_picocolors5.default.yellow(d)}  ` : "";
          const barEnd = withGuide ? import_picocolors5.default.yellow(x2) : "";
          return `${head.trim()}
${bar}${input}
${barEnd}${errorMsg}
`;
        }
        case "submit": {
          const val = value ? `  ${import_picocolors5.default.dim(value)}` : "";
          const bar = withGuide ? import_picocolors5.default.gray(d) : "";
          return `${head}${bar}${val}`;
        }
        case "cancel": {
          const val = value ? `  ${import_picocolors5.default.strikethrough(import_picocolors5.default.dim(value))}` : "";
          const bar = withGuide ? import_picocolors5.default.gray(d) : "";
          return `${head}${bar}${val}${value.trim() ? `
${bar}` : ""}`;
        }
        default: {
          const bar = withGuide ? `${import_picocolors5.default.cyan(d)}  ` : "";
          const barEnd = withGuide ? import_picocolors5.default.cyan(x2) : "";
          return `${head}${bar}${input}
${barEnd}
`;
        }
      }
    }
  });
  if (fillValue) {
    prompt.on("key", (_key, info) => {
      if (info?.name === "tab" && !prompt.userInput) {
        ;
        prompt._setUserInput(fillValue, true);
      }
    });
  }
  return prompt.prompt();
}

// src/commands/setup.ts
var import_picocolors8 = __toESM(require_picocolors(), 1);

// src/prompts/prerequisites.ts
var import_picocolors6 = __toESM(require_picocolors(), 1);

// src/services/docker.ts
import { execSync, spawn, spawnSync } from "child_process";
function isDockerInstalled() {
  try {
    execSync("docker --version", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}
function isDockerComposeV2() {
  try {
    const output = execSync("docker compose version", { stdio: "pipe" }).toString();
    return output.includes("v2");
  } catch {
    return false;
  }
}
function isDockerRunning() {
  try {
    execSync("docker info", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}
function dockerComposeUp(cwd) {
  execSync("docker compose up -d --pull always", {
    cwd,
    stdio: "inherit"
  });
}
function dockerComposeDown(cwd) {
  execSync("docker compose down", {
    cwd,
    stdio: "inherit"
  });
}
function dockerComposeLogs(cwd) {
  const child = spawn("docker", ["compose", "logs", "--tail", "all", "-f"], {
    cwd,
    stdio: "inherit"
  });
  process.on("SIGINT", () => {
    child.kill("SIGINT");
  });
  child.on("exit", () => process.exit(0));
}
function dockerLogsMulti(containerNames) {
  const children = containerNames.map(
    (name) => spawn("docker", ["logs", "--tail", "all", "-f", "--timestamps", name], {
      stdio: ["ignore", "inherit", "inherit"]
    })
  );
  process.on("SIGINT", () => {
    for (const child of children) child.kill("SIGINT");
  });
  let exited = 0;
  for (const child of children) {
    child.on("exit", () => {
      exited++;
      if (exited === children.length) process.exit(0);
    });
  }
}
function dockerExecToFile(containerName, command, outputPath) {
  execSync(`docker exec ${containerName} ${command} > "${outputPath}"`, {
    stdio: "pipe",
    shell: "/bin/sh",
    maxBuffer: 1024 * 1024 * 512
  });
}
function dockerExecFromFile(containerName, command, inputPath) {
  execSync(`docker exec -i ${containerName} ${command} < "${inputPath}"`, {
    stdio: "pipe",
    shell: "/bin/sh",
    maxBuffer: 1024 * 1024 * 512
  });
}
function isContainerRunning(containerName) {
  try {
    const output = execSync(
      `docker inspect -f '{{.State.Running}}' ${containerName}`,
      { stdio: "pipe" }
    ).toString().trim();
    return output === "true";
  } catch {
    return false;
  }
}
function dockerStats(cwd) {
  return execSync(
    'docker compose stats --no-stream --format "table {{.Name}}	{{.CPUPerc}}	{{.MemUsage}}	{{.MemPerc}}	{{.NetIO}}"',
    { cwd, stdio: "pipe" }
  ).toString();
}
function dockerStatsForContainers(containerNames) {
  if (containerNames.length === 0) return "";
  return execSync(
    `docker stats --no-stream --format "table {{.Name}}	{{.CPUPerc}}	{{.MemUsage}}	{{.MemPerc}}	{{.NetIO}}" ${containerNames.join(" ")}`,
    { stdio: "pipe" }
  ).toString();
}
function getContainerLogs(containerName, lines = 50) {
  return execSync(`docker logs --tail ${lines} ${containerName}`, {
    stdio: "pipe"
  }).toString();
}
function getDockerDiskUsage() {
  return execSync("docker system df", { stdio: "pipe" }).toString();
}
function autoDetectDeploymentId() {
  try {
    const output = execSync(
      'docker ps -a --filter "name=learnhouse-app-" --format "{{.Names}}"',
      { stdio: "pipe" }
    ).toString().trim();
    if (!output) return null;
    const match = output.split("\n")[0].match(/learnhouse-app-([a-f0-9]+)$/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}
function listDeploymentContainers(deploymentId) {
  try {
    const id = deploymentId || autoDetectDeploymentId();
    if (!id) return [];
    const output = execSync(
      `docker ps -a --filter "name=learnhouse-" --format "{{.Names}}\\t{{.Status}}\\t{{.Image}}"`,
      { stdio: "pipe" }
    ).toString().trim();
    if (!output) return [];
    return output.split("\n").filter((line) => line.includes(id)).map((line) => {
      const [name, status, image] = line.split("	");
      return { name, status, image };
    });
  } catch {
    return [];
  }
}
function getContainerRestartCount(containerName) {
  try {
    const output = execSync(
      `docker inspect -f '{{.RestartCount}}' ${containerName}`,
      { stdio: "pipe" }
    ).toString().trim();
    return parseInt(output, 10) || 0;
  } catch {
    return 0;
  }
}
function dockerExecInteractive(containerName, cmd) {
  const result = spawnSync("docker", ["exec", "-it", containerName, ...cmd.split(" ")], {
    stdio: "inherit"
  });
  if (result.status !== null) {
    process.exitCode = result.status;
  }
}

// src/prompts/prerequisites.ts
async function checkPrerequisites() {
  const s = bt2();
  s.start("Checking prerequisites");
  const checks = [
    {
      name: "Docker Engine",
      check: isDockerInstalled,
      failMsg: `Docker is not installed. Install it from ${import_picocolors6.default.underline("https://docs.docker.com/get-docker/")}`
    },
    {
      name: "Docker Compose v2",
      check: isDockerComposeV2,
      failMsg: `Docker Compose v2 is required. Install it from ${import_picocolors6.default.underline("https://docs.docker.com/compose/install/")}`
    },
    {
      name: "Docker daemon",
      check: isDockerRunning,
      failMsg: "Docker daemon is not running. Please start Docker and try again."
    }
  ];
  const failed = [];
  for (const { name, check, failMsg } of checks) {
    if (!check()) {
      failed.push(`${import_picocolors6.default.red("x")} ${name}: ${failMsg}`);
    }
  }
  if (failed.length > 0) {
    s.stop("Prerequisites check failed");
    R2.error("Missing prerequisites:");
    for (const msg of failed) {
      R2.message(msg);
    }
    Ne("Please install the missing prerequisites and try again.");
    process.exit(1);
  }
  s.stop("All prerequisites met");
}

// src/utils/validators.ts
function validateEmail(value) {
  if (!value) return "Email is required";
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!re.test(value)) return "Please enter a valid email address";
  return void 0;
}
function validatePassword(value) {
  if (!value) return "Password is required";
  if (value.length < 8) return "Password must be at least 8 characters";
  return void 0;
}
function validateDomain(value) {
  if (!value) return "Domain is required";
  if (value === "localhost") return void 0;
  const re = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/;
  if (!re.test(value)) return "Please enter a valid domain (e.g., learnhouse.example.com)";
  return void 0;
}
function validatePort(value) {
  const num = parseInt(value, 10);
  if (isNaN(num) || num < 1 || num > 65535) return "Port must be between 1 and 65535";
  return void 0;
}
function validateRequired(value) {
  if (!value || value.trim() === "") return "This field is required";
  return void 0;
}

// src/prompts/domain.ts
async function promptDomain() {
  const domain = await text({
    message: "What domain will LearnHouse be hosted on?",
    placeholder: "localhost",
    defaultValue: "localhost",
    validate: validateDomain
  });
  if (Ct(domain)) {
    Ne();
    process.exit(0);
  }
  let useHttps = false;
  let autoSsl = false;
  let sslEmail;
  if (domain !== "localhost") {
    const httpsChoice = await Je({
      message: "HTTPS configuration?",
      options: [
        { value: "auto", label: "Automatic SSL (Let's Encrypt via Caddy)", hint: "recommended" },
        { value: "manual", label: "I'll handle SSL myself (reverse proxy, Cloudflare, etc.)" },
        { value: "none", label: "No HTTPS (HTTP only)", hint: "not recommended for production" }
      ]
    });
    if (Ct(httpsChoice)) {
      Ne();
      process.exit(0);
    }
    if (httpsChoice === "auto") {
      useHttps = true;
      autoSsl = true;
      const email = await text({
        message: "Email for Let's Encrypt notifications?",
        placeholder: "admin@example.com",
        validate: validateEmail
      });
      if (Ct(email)) {
        Ne();
        process.exit(0);
      }
      sslEmail = email;
    } else if (httpsChoice === "manual") {
      useHttps = true;
    }
  }
  const defaultPort = autoSsl ? 443 : 80;
  const portMessage = autoSsl ? "HTTPS port? (Caddy needs 443 for auto SSL, and will also listen on 80 for redirect)" : "HTTP port for the web server?";
  const port = await text({
    message: portMessage,
    placeholder: String(defaultPort),
    defaultValue: String(defaultPort),
    validate: validatePort
  });
  if (Ct(port)) {
    Ne();
    process.exit(0);
  }
  return {
    domain,
    useHttps,
    httpPort: parseInt(port, 10),
    autoSsl,
    sslEmail
  };
}

// src/prompts/database.ts
import crypto from "crypto";
var import_picocolors7 = __toESM(require_picocolors(), 1);

// src/utils/network.ts
import net from "net";
function checkPort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port);
  });
}
function checkTcpConnection(host, port, timeoutMs = 5e3) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, timeoutMs);
    socket.once("connect", () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}
function parsePostgresUrl(connString) {
  try {
    const url = new URL(connString);
    return { host: url.hostname, port: url.port ? parseInt(url.port, 10) : 5432 };
  } catch {
    return null;
  }
}
function parseRedisUrl(connString) {
  try {
    const url = new URL(connString);
    return { host: url.hostname, port: url.port ? parseInt(url.port, 10) : 6379 };
  } catch {
    return null;
  }
}

// src/prompts/database.ts
async function promptAndVerifyPostgres() {
  while (true) {
    const connString = await text({
      message: "PostgreSQL connection string?",
      placeholder: "postgresql://user:password@host:5432/learnhouse",
      validate: (value) => {
        const err = validateRequired(value);
        if (err) return err;
        if (!value.startsWith("postgresql://") && !value.startsWith("postgres://")) {
          return "Must start with postgresql:// or postgres://";
        }
        return void 0;
      }
    });
    if (Ct(connString)) {
      Ne();
      process.exit(0);
    }
    const parsed = parsePostgresUrl(connString);
    if (!parsed) {
      R2.error("Could not parse the connection string. Please check the format.");
      continue;
    }
    const s = bt2();
    s.start(`Checking connection to ${parsed.host}:${parsed.port}`);
    const reachable = await checkTcpConnection(parsed.host, parsed.port);
    if (reachable) {
      s.stop(`${import_picocolors7.default.green("Connected")} to ${parsed.host}:${parsed.port}`);
      return connString;
    }
    s.stop(`${import_picocolors7.default.red("Connection failed")} to ${parsed.host}:${parsed.port}`);
    const retry = await Re({
      message: "Could not reach the database. Try a different connection string?",
      initialValue: true
    });
    if (Ct(retry) || !retry) {
      Ne();
      process.exit(0);
    }
  }
}
async function promptAndVerifyRedis() {
  while (true) {
    const connString = await text({
      message: "Redis connection string?",
      placeholder: "redis://user:password@host:6379/0",
      validate: (value) => {
        const err = validateRequired(value);
        if (err) return err;
        if (!value.startsWith("redis://") && !value.startsWith("rediss://")) {
          return "Must start with redis:// or rediss://";
        }
        return void 0;
      }
    });
    if (Ct(connString)) {
      Ne();
      process.exit(0);
    }
    const parsed = parseRedisUrl(connString);
    if (!parsed) {
      R2.error("Could not parse the connection string. Please check the format.");
      continue;
    }
    const s = bt2();
    s.start(`Checking connection to ${parsed.host}:${parsed.port}`);
    const reachable = await checkTcpConnection(parsed.host, parsed.port);
    if (reachable) {
      s.stop(`${import_picocolors7.default.green("Connected")} to ${parsed.host}:${parsed.port}`);
      return connString;
    }
    s.stop(`${import_picocolors7.default.red("Connection failed")} to ${parsed.host}:${parsed.port}`);
    const retry = await Re({
      message: "Could not reach Redis. Try a different connection string?",
      initialValue: true
    });
    if (Ct(retry) || !retry) {
      Ne();
      process.exit(0);
    }
  }
}
async function promptDatabase() {
  const dbChoice = await Je({
    message: "PostgreSQL database setup?",
    options: [
      { value: "local", label: "Create a new database (Docker)", hint: "recommended" },
      { value: "external", label: "Use an external database", hint: "bring your own PostgreSQL" }
    ]
  });
  if (Ct(dbChoice)) {
    Ne();
    process.exit(0);
  }
  let useExternalDb = false;
  let externalDbConnectionString;
  let dbPassword;
  let useAiDatabase = false;
  if (dbChoice === "external") {
    externalDbConnectionString = await promptAndVerifyPostgres();
    useExternalDb = true;
  } else {
    const dbImageChoice = await Je({
      message: "Which PostgreSQL image?",
      options: [
        { value: "ai", label: "PostgreSQL with AI capabilities", hint: "recommended \u2014 enables AI course chatbot (RAG)" },
        { value: "standard", label: "Standard PostgreSQL", hint: "lighter image, no AI search features" }
      ]
    });
    if (Ct(dbImageChoice)) {
      Ne();
      process.exit(0);
    }
    useAiDatabase = dbImageChoice === "ai";
    dbPassword = crypto.randomBytes(24).toString("base64url");
    R2.message("");
    R2.info(import_picocolors7.default.bold("Database credentials generated:"));
    R2.message([
      "",
      `  ${import_picocolors7.default.dim("User:")}     learnhouse`,
      `  ${import_picocolors7.default.dim("Password:")} ${import_picocolors7.default.cyan(dbPassword)}`,
      `  ${import_picocolors7.default.dim("Database:")} learnhouse`,
      `  ${import_picocolors7.default.dim("Host:")}     db:5432 (internal)`,
      "",
      `  ${import_picocolors7.default.yellow("Copy the password now if needed \u2014 it will be saved in .env")}`,
      ""
    ].join("\n"));
    const ack = await Re({ message: "Continue?", initialValue: true });
    if (Ct(ack) || !ack) {
      Ne();
      process.exit(0);
    }
  }
  const redisChoice = await Je({
    message: "Redis setup?",
    options: [
      { value: "local", label: "Create a new Redis instance (Docker)", hint: "recommended" },
      { value: "external", label: "Use an external Redis", hint: "bring your own Redis" }
    ]
  });
  if (Ct(redisChoice)) {
    Ne();
    process.exit(0);
  }
  let useExternalRedis = false;
  let externalRedisConnectionString;
  if (redisChoice === "external") {
    externalRedisConnectionString = await promptAndVerifyRedis();
    useExternalRedis = true;
  }
  return {
    useExternalDb,
    externalDbConnectionString,
    dbPassword,
    useAiDatabase,
    useExternalRedis,
    externalRedisConnectionString
  };
}

// src/prompts/organization.ts
async function promptOrganization() {
  const orgName = await text({
    message: "Organization name?",
    placeholder: "My School",
    defaultValue: "My School",
    validate: validateRequired
  });
  if (Ct(orgName)) {
    Ne();
    process.exit(0);
  }
  return {
    orgName
  };
}

// src/prompts/admin.ts
async function promptAdmin() {
  const email = await text({
    message: "Admin email address?",
    placeholder: "admin@example.com",
    validate: validateEmail
  });
  if (Ct(email)) {
    Ne();
    process.exit(0);
  }
  const password = await He({
    message: "Admin password? (min 8 characters)",
    validate: validatePassword
  });
  if (Ct(password)) {
    Ne();
    process.exit(0);
  }
  return {
    adminEmail: email,
    adminPassword: password
  };
}

// src/prompts/features.ts
async function promptFeatures() {
  const selected = await je({
    message: "Enable optional features? (Space to toggle, Enter to confirm)",
    options: [
      { value: "ai", label: "AI Features (Gemini)" },
      { value: "email", label: "Email (Resend or SMTP)" },
      { value: "s3", label: "S3 Storage" },
      { value: "google", label: "Google OAuth" },
      { value: "unsplash", label: "Unsplash Images" }
    ],
    required: false
  });
  if (Ct(selected)) {
    Ne();
    process.exit(0);
  }
  const features = selected;
  const config = {
    aiEnabled: features.includes("ai"),
    emailEnabled: features.includes("email"),
    s3Enabled: features.includes("s3"),
    googleOAuthEnabled: features.includes("google"),
    unsplashEnabled: features.includes("unsplash")
  };
  if (config.aiEnabled) {
    R2.info("Configure AI (Gemini)");
    const key = await text({
      message: "Gemini API key?",
      placeholder: "AIza...",
      validate: validateRequired
    });
    if (Ct(key)) {
      Ne();
      process.exit(0);
    }
    config.geminiApiKey = key;
  }
  if (config.emailEnabled) {
    const provider = await Je({
      message: "Email provider?",
      options: [
        { value: "smtp", label: "SMTP (any provider)" },
        { value: "resend", label: "Resend" }
      ]
    });
    if (Ct(provider)) {
      Ne();
      process.exit(0);
    }
    config.emailProvider = provider;
    if (config.emailProvider === "resend") {
      R2.info("Configure Email (Resend)");
      const key = await text({
        message: "Resend API key?",
        placeholder: "re_...",
        validate: validateRequired
      });
      if (Ct(key)) {
        Ne();
        process.exit(0);
      }
      config.resendApiKey = key;
    } else {
      R2.info("Configure Email (SMTP)");
      const host = await text({
        message: "SMTP host?",
        placeholder: "smtp.gmail.com",
        validate: validateRequired
      });
      if (Ct(host)) {
        Ne();
        process.exit(0);
      }
      config.smtpHost = host;
      const port = await text({
        message: "SMTP port?",
        initialValue: "587",
        validate: validateRequired
      });
      if (Ct(port)) {
        Ne();
        process.exit(0);
      }
      config.smtpPort = parseInt(port, 10);
      const username = await text({
        message: "SMTP username?",
        validate: validateRequired
      });
      if (Ct(username)) {
        Ne();
        process.exit(0);
      }
      config.smtpUsername = username;
      const password = await He({
        message: "SMTP password?",
        validate: validateRequired
      });
      if (Ct(password)) {
        Ne();
        process.exit(0);
      }
      config.smtpPassword = password;
      const useTls = await Re({
        message: "Use TLS?",
        initialValue: true
      });
      if (Ct(useTls)) {
        Ne();
        process.exit(0);
      }
      config.smtpUseTls = useTls;
    }
    const email = await text({
      message: "System email address (From)?",
      placeholder: "noreply@yourdomain.com",
      validate: validateRequired
    });
    if (Ct(email)) {
      Ne();
      process.exit(0);
    }
    config.systemEmailAddress = email;
  }
  if (config.s3Enabled) {
    R2.info("Configure S3 Storage");
    const bucket = await text({
      message: "S3 bucket name?",
      validate: validateRequired
    });
    if (Ct(bucket)) {
      Ne();
      process.exit(0);
    }
    config.s3BucketName = bucket;
    const endpoint = await text({
      message: "S3 endpoint URL? (leave empty for AWS S3)",
      placeholder: "https://s3.amazonaws.com"
    });
    if (Ct(endpoint)) {
      Ne();
      process.exit(0);
    }
    if (endpoint) config.s3EndpointUrl = endpoint;
  }
  if (config.googleOAuthEnabled) {
    R2.info("Configure Google OAuth");
    const clientId = await text({
      message: "Google Client ID?",
      validate: validateRequired
    });
    if (Ct(clientId)) {
      Ne();
      process.exit(0);
    }
    config.googleClientId = clientId;
    const clientSecret = await text({
      message: "Google Client Secret?",
      validate: validateRequired
    });
    if (Ct(clientSecret)) {
      Ne();
      process.exit(0);
    }
    config.googleClientSecret = clientSecret;
  }
  if (config.unsplashEnabled) {
    R2.info("Configure Unsplash");
    const key = await text({
      message: "Unsplash Access Key?",
      validate: validateRequired
    });
    if (Ct(key)) {
      Ne();
      process.exit(0);
    }
    config.unsplashAccessKey = key;
  }
  return config;
}

// src/templates/docker-compose.ts
function generateDockerCompose(config, appImage) {
  const image = appImage || APP_IMAGE;
  const id = config.deploymentId;
  const useLocalDb = !config.useExternalDb;
  const useLocalRedis = !config.useExternalRedis;
  const deps = [];
  if (useLocalDb) deps.push("      db:\n        condition: service_healthy");
  if (useLocalRedis) deps.push("      redis:\n        condition: service_healthy");
  const appDependsOn = deps.length > 0 ? `    depends_on:
${deps.join("\n")}` : "";
  const proxyService = config.autoSsl ? `
  caddy:
    image: caddy:2-alpine
    container_name: learnhouse-caddy-${id}
    restart: unless-stopped
    ports:
      - "80:80"
      - "\${HTTP_PORT:-443}:443"
    volumes:
      - ./extra/Caddyfile:/etc/caddy/Caddyfile:ro
      - learnhouse_caddy_data_${id}:/data
      - learnhouse_caddy_config_${id}:/config
    depends_on:
      learnhouse-app:
        condition: service_healthy
    networks:
      - learnhouse-network-${id}
    healthcheck:
      test: ["CMD-SHELL", "wget --quiet --tries=1 --spider http://localhost:80/ || exit 1"]
      interval: 30s
      timeout: 10s
      retries: 3
` : `
  nginx:
    image: nginx:alpine
    container_name: learnhouse-nginx-${id}
    restart: unless-stopped
    ports:
      - "\${HTTP_PORT:-80}:80"
    volumes:
      - ./extra/nginx.prod.conf:/etc/nginx/conf.d/default.conf:ro
    depends_on:
      learnhouse-app:
        condition: service_healthy
    networks:
      - learnhouse-network-${id}
    healthcheck:
      test: ["CMD-SHELL", "wget --quiet --tries=1 --spider http://localhost/ || exit 1"]
      interval: 30s
      timeout: 10s
      retries: 3
`;
  const dbImage = config.useAiDatabase ? POSTGRES_AI_IMAGE : POSTGRES_IMAGE;
  const dbService = useLocalDb ? `
  db:
    image: ${dbImage}
    container_name: learnhouse-db-${id}
    restart: unless-stopped
    env_file:
      - .env
    environment:
      - POSTGRES_USER=\${POSTGRES_USER:-learnhouse}
      - POSTGRES_PASSWORD=\${POSTGRES_PASSWORD:-learnhouse}
      - POSTGRES_DB=\${POSTGRES_DB:-learnhouse}
    volumes:
      - learnhouse_db_data_${id}:/var/lib/postgresql/data
    networks:
      - learnhouse-network-${id}
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U \${POSTGRES_USER:-learnhouse}"]
      interval: 5s
      timeout: 4s
      retries: 5
` : "";
  const redisService = useLocalRedis ? `
  redis:
    image: redis:7.2.3-alpine
    container_name: learnhouse-redis-${id}
    restart: unless-stopped
    command: redis-server --appendonly yes
    volumes:
      - learnhouse_redis_data_${id}:/data
    networks:
      - learnhouse-network-${id}
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 4s
      retries: 5
` : "";
  const volumeEntries = [];
  if (config.autoSsl) {
    volumeEntries.push(`  learnhouse_caddy_data_${id}:`);
    volumeEntries.push(`  learnhouse_caddy_config_${id}:`);
  }
  if (useLocalDb) volumeEntries.push(`  learnhouse_db_data_${id}:`);
  if (useLocalRedis) volumeEntries.push(`  learnhouse_redis_data_${id}:`);
  const volumesSection = volumeEntries.length > 0 ? `volumes:
${volumeEntries.join("\n")}` : "";
  return `name: learnhouse-${id}

services:
  learnhouse-app:
    image: ${image}
    container_name: learnhouse-app-${id}
    restart: unless-stopped
    env_file:
      - .env
    environment:
      # HOSTNAME needs to be set explicitly for the container
      - HOSTNAME=0.0.0.0
      - LEARNHOUSE_API_URL=http://localhost:9000
${appDependsOn}
    networks:
      - learnhouse-network-${id}
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost/api/v1/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 60s
${proxyService}${dbService}${redisService}
networks:
  learnhouse-network-${id}:
    driver: bridge

${volumesSection}
`;
}

// src/templates/env.ts
import crypto2 from "crypto";
function generateSecret() {
  return crypto2.randomBytes(32).toString("base64");
}
function generateEnvFile(config) {
  const protocol = config.useHttps ? "https" : "http";
  const portSuffix = config.useHttps && config.httpPort === 443 || !config.useHttps && config.httpPort === 80 ? "" : `:${config.httpPort}`;
  const baseUrl = `${protocol}://${config.domain}${portSuffix}`;
  const domainWithPort = `${config.domain}${portSuffix}`;
  const topDomain = config.domain === "localhost" ? "localhost" : config.domain.split(".").slice(-2).join(".");
  const cookieDomain = config.domain === "localhost" ? ".localhost" : `.${topDomain}`;
  const nextAuthSecret = generateSecret();
  const jwtSecret = generateSecret();
  const collabInternalKey = generateSecret();
  const lines = [
    "# LearnHouse Environment Variables",
    "# Generated by LearnHouse CLI",
    "",
    "# =============================================================================",
    "# Domain & Hosting Configuration",
    "# =============================================================================",
    "",
    `LEARNHOUSE_DOMAIN=${domainWithPort}`,
    `HTTP_PORT=${config.httpPort}`,
    "",
    "# =============================================================================",
    "# Frontend Environment Variables (NEXT_PUBLIC_*)",
    "# =============================================================================",
    "",
    `NEXT_PUBLIC_LEARNHOUSE_API_URL=${baseUrl}/api/v1/`,
    `NEXT_PUBLIC_LEARNHOUSE_BACKEND_URL=${baseUrl}/`,
    `NEXT_PUBLIC_LEARNHOUSE_DOMAIN=${domainWithPort}`,
    `NEXT_PUBLIC_LEARNHOUSE_TOP_DOMAIN=${topDomain}`,
    "NEXT_PUBLIC_LEARNHOUSE_MULTI_ORG=False",
    "NEXT_PUBLIC_LEARNHOUSE_DEFAULT_ORG=default",
    `NEXT_PUBLIC_LEARNHOUSE_HTTPS=${config.useHttps ? "True" : "False"}`
  ];
  if (config.unsplashEnabled && config.unsplashAccessKey) {
    lines.push(`NEXT_PUBLIC_UNSPLASH_ACCESS_KEY=${config.unsplashAccessKey}`);
  }
  lines.push(
    "",
    "# =============================================================================",
    "# NextAuth Configuration",
    "# =============================================================================",
    "",
    `NEXTAUTH_URL=${baseUrl}`,
    `NEXTAUTH_SECRET=${nextAuthSecret}`
  );
  if (config.googleOAuthEnabled && config.googleClientId && config.googleClientSecret) {
    lines.push(
      `LEARNHOUSE_GOOGLE_CLIENT_ID=${config.googleClientId}`,
      `LEARNHOUSE_GOOGLE_CLIENT_SECRET=${config.googleClientSecret}`
    );
  }
  lines.push(
    "",
    "# =============================================================================",
    "# Backend Configuration",
    "# =============================================================================",
    "",
    `LEARNHOUSE_SQL_CONNECTION_STRING=${config.useExternalDb ? config.externalDbConnectionString : `postgresql://learnhouse:${config.dbPassword}@db:5432/learnhouse`}`,
    `LEARNHOUSE_REDIS_CONNECTION_STRING=${config.useExternalRedis ? config.externalRedisConnectionString : "redis://redis:6379/learnhouse"}`,
    `LEARNHOUSE_COOKIE_DOMAIN=${cookieDomain}`,
    "LEARNHOUSE_PORT=9000",
    "",
    "# =============================================================================",
    "# Security",
    "# =============================================================================",
    "",
    `LEARNHOUSE_AUTH_JWT_SECRET_KEY=${jwtSecret}`,
    `LEARNHOUSE_INITIAL_ADMIN_EMAIL=${config.adminEmail}`,
    `LEARNHOUSE_INITIAL_ADMIN_PASSWORD=${config.adminPassword}`,
    "",
    "# =============================================================================",
    "# Collaboration Server",
    "# =============================================================================",
    "",
    `COLLAB_INTERNAL_KEY=${collabInternalKey}`,
    `LEARNHOUSE_REDIS_URL=${config.useExternalRedis ? config.externalRedisConnectionString : "redis://redis:6379"}`,
    `NEXT_PUBLIC_COLLAB_URL=${config.useHttps ? "wss" : "ws"}://${config.domain}${portSuffix}/collab`,
    "",
    "# =============================================================================",
    "# General Settings",
    "# =============================================================================",
    "",
    "LEARNHOUSE_DEVELOPMENT_MODE=False",
    "LEARNHOUSE_LOGFIRE_ENABLED=False"
  );
  if (config.aiEnabled && config.geminiApiKey) {
    lines.push(
      "",
      "# =============================================================================",
      "# AI Configuration",
      "# =============================================================================",
      "",
      `LEARNHOUSE_GEMINI_API_KEY=${config.geminiApiKey}`,
      "LEARNHOUSE_IS_AI_ENABLED=True"
    );
  } else {
    lines.push(
      "",
      "# =============================================================================",
      "# AI Configuration",
      "# =============================================================================",
      "",
      "LEARNHOUSE_IS_AI_ENABLED=False"
    );
  }
  if (config.emailEnabled) {
    const provider = config.emailProvider || "resend";
    lines.push(
      "",
      "# =============================================================================",
      "# Email Configuration",
      "# =============================================================================",
      "",
      `LEARNHOUSE_EMAIL_PROVIDER=${provider}`,
      `LEARNHOUSE_SYSTEM_EMAIL_ADDRESS=${config.systemEmailAddress || `noreply@${config.domain}`}`
    );
    if (provider === "resend" && config.resendApiKey) {
      lines.push(`LEARNHOUSE_RESEND_API_KEY=${config.resendApiKey}`);
    }
    if (provider === "smtp") {
      if (config.smtpHost) lines.push(`LEARNHOUSE_SMTP_HOST=${config.smtpHost}`);
      lines.push(`LEARNHOUSE_SMTP_PORT=${config.smtpPort || 587}`);
      if (config.smtpUsername) lines.push(`LEARNHOUSE_SMTP_USERNAME=${config.smtpUsername}`);
      if (config.smtpPassword) lines.push(`LEARNHOUSE_SMTP_PASSWORD=${config.smtpPassword}`);
      lines.push(`LEARNHOUSE_SMTP_USE_TLS=${config.smtpUseTls !== false ? "True" : "False"}`);
    }
  }
  if (config.s3Enabled && config.s3BucketName) {
    lines.push(
      "",
      "# =============================================================================",
      "# Content Delivery",
      "# =============================================================================",
      "",
      "LEARNHOUSE_CONTENT_DELIVERY_TYPE=s3api",
      `LEARNHOUSE_S3_API_BUCKET_NAME=${config.s3BucketName}`
    );
    if (config.s3EndpointUrl) {
      lines.push(`LEARNHOUSE_S3_API_ENDPOINT_URL=${config.s3EndpointUrl}`);
    }
  } else {
    lines.push(
      "",
      "# =============================================================================",
      "# Content Delivery",
      "# =============================================================================",
      "",
      "LEARNHOUSE_CONTENT_DELIVERY_TYPE=filesystem"
    );
  }
  if (!config.useExternalDb) {
    lines.push(
      "",
      "# =============================================================================",
      "# Database Configuration",
      "# =============================================================================",
      "",
      "POSTGRES_USER=learnhouse",
      `POSTGRES_PASSWORD=${config.dbPassword}`,
      "POSTGRES_DB=learnhouse",
      ""
    );
  } else {
    lines.push("");
  }
  return lines.join("\n");
}

// src/templates/nginx.ts
function generateNginxConf() {
  return `
server {
    listen 80;
    server_name _;
    client_max_body_size 500M;

    # Increase header buffer size
    large_client_header_buffers 4 32k;

    # Increase the maximum allowed size of the client request body
    client_body_buffer_size 32k;

    # Increase the maximum allowed size of the client request header fields
    client_header_buffer_size 32k;

    # Proxy all requests to the learnhouse-app service
    # The app container has internal nginx routing between frontend, backend, and collab
    location / {
        proxy_pass http://learnhouse-app:80;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket support (needed for /collab)
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        # Timeouts for long-running requests and WebSocket connections
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
        proxy_connect_timeout 75s;
    }
}
`;
}

// src/templates/caddyfile.ts
function generateCaddyfile(config) {
  const email = config.sslEmail || "admin@example.com";
  return `{
  email ${email}
}

${config.domain} {
  reverse_proxy learnhouse-app:80
}
`;
}

// src/services/config-store.ts
import fs from "fs";
import path from "path";
function writeConfig(config) {
  const data = {
    version: VERSION,
    deploymentId: config.deploymentId,
    createdAt: (/* @__PURE__ */ new Date()).toISOString(),
    installDir: config.installDir,
    domain: config.domain,
    httpPort: config.httpPort,
    useHttps: config.useHttps,
    autoSsl: config.autoSsl,
    useExternalDb: config.useExternalDb,
    orgSlug: "default"
  };
  fs.writeFileSync(
    path.join(config.installDir, CONFIG_FILENAME),
    JSON.stringify(data, null, 2) + "\n"
  );
}
function readConfig(dir) {
  const configPath = path.join(dir || process.cwd(), CONFIG_FILENAME);
  if (!fs.existsSync(configPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch {
    return null;
  }
}
function isCompleteInstall(dir) {
  const configPath = path.join(dir, CONFIG_FILENAME);
  if (!fs.existsSync(configPath)) return false;
  try {
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    return !!config.deploymentId && fs.existsSync(path.join(dir, ".env"));
  } catch {
    return false;
  }
}
function collectCandidates(dir, depth, results) {
  if (depth < 0) return;
  if (fs.existsSync(path.join(dir, CONFIG_FILENAME))) {
    results.push(dir);
  }
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist" || entry.name === "backups") continue;
      collectCandidates(path.join(dir, entry.name), depth - 1, results);
    }
  } catch {
  }
}
function pickBest(candidates) {
  if (candidates.length === 0) return null;
  const completeInstalls = candidates.filter(isCompleteInstall);
  if (completeInstalls.length > 0) {
    completeInstalls.sort((a, b) => {
      try {
        const configA = JSON.parse(fs.readFileSync(path.join(a, CONFIG_FILENAME), "utf-8"));
        const configB = JSON.parse(fs.readFileSync(path.join(b, CONFIG_FILENAME), "utf-8"));
        return (configB.createdAt || "").localeCompare(configA.createdAt || "");
      } catch {
        return 0;
      }
    });
    return completeInstalls[0];
  }
  return candidates[0];
}
function findInstallDir() {
  const cwd = process.cwd();
  if (isCompleteInstall(cwd)) return cwd;
  const subDir = path.join(cwd, "learnhouse");
  if (isCompleteInstall(subDir)) return subDir;
  const candidates = [];
  collectCandidates(cwd, 10, candidates);
  const best = pickBest(candidates);
  if (best) return best;
  let current = cwd;
  let fallbackDir = null;
  while (true) {
    const parent = path.dirname(current);
    if (parent === current) break;
    if (isCompleteInstall(parent)) return parent;
    const parentSub = path.join(parent, "learnhouse");
    if (isCompleteInstall(parentSub)) return parentSub;
    if (!fallbackDir && fs.existsSync(path.join(parent, CONFIG_FILENAME))) {
      fallbackDir = parent;
    }
    current = parent;
  }
  if (fallbackDir) return fallbackDir;
  return cwd;
}

// src/services/health.ts
async function waitForHealth(baseUrl) {
  const url = `${baseUrl}/api/v1/health`;
  const deadline = Date.now() + HEALTH_CHECK_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5e3) });
      if (res.ok) return true;
    } catch {
    }
    await new Promise((r) => setTimeout(r, HEALTH_CHECK_INTERVAL_MS));
  }
  return false;
}

// src/commands/setup.ts
var STEP_NAMES = [
  "Install Directory",
  "Domain Configuration",
  "Database & Redis",
  "Organization Setup",
  "Admin Account",
  "Optional Features"
];
var BACK = /* @__PURE__ */ Symbol("back");
async function confirmOrBack(message) {
  if (STEP_NAMES.length === 0) return true;
  const result = await Je({
    message,
    options: [
      { value: "continue", label: "Continue" },
      { value: "back", label: import_picocolors8.default.dim("Go back to previous step") }
    ]
  });
  if (Ct(result)) {
    Ne();
    process.exit(0);
  }
  return result === "back" ? BACK : true;
}
async function stepInstallDir() {
  const defaultDir = fs2.existsSync(path2.join(process.cwd(), "learnhouse", "learnhouse.config.json")) ? "./learnhouse-new" : "./learnhouse";
  const installDir = await text({
    message: "Where should LearnHouse be installed?",
    placeholder: defaultDir,
    defaultValue: defaultDir
  });
  if (Ct(installDir)) {
    Ne();
    process.exit(0);
  }
  const resolved = path2.resolve(installDir);
  if (fs2.existsSync(path2.join(resolved, "learnhouse.config.json"))) {
    R2.warn(`${resolved} already contains a LearnHouse installation.`);
    const overwrite = await Re({
      message: "Overwrite existing installation?",
      initialValue: false
    });
    if (Ct(overwrite) || !overwrite) {
      Ne("Setup cancelled.");
      process.exit(0);
    }
  }
  return resolved;
}
async function stepDomain() {
  R2.step(import_picocolors8.default.cyan(`Step 2/6`) + " Domain Configuration");
  const config = await promptDomain();
  const portAvailable = await checkPort(config.httpPort);
  if (!portAvailable) {
    R2.warn(`Port ${config.httpPort} is already in use. You may need to free it before starting.`);
  }
  return config;
}
async function stepDatabase() {
  R2.step(import_picocolors8.default.cyan(`Step 3/6`) + " Database & Redis");
  return await promptDatabase();
}
async function stepOrganization() {
  R2.step(import_picocolors8.default.cyan(`Step 4/6`) + " Organization Setup");
  return await promptOrganization();
}
async function stepAdmin() {
  R2.step(import_picocolors8.default.cyan(`Step 5/6`) + " Admin Account");
  return await promptAdmin();
}
async function stepFeatures() {
  R2.step(import_picocolors8.default.cyan(`Step 6/6`) + " Optional Features");
  return await promptFeatures();
}
async function setupCommand() {
  await printBanner();
  We(import_picocolors8.default.cyan("LearnHouse Setup Wizard"));
  await checkPrerequisites();
  const channelChoice = await Je({
    message: "Which release channel do you want to use?",
    options: [
      {
        value: "stable",
        label: "Stable",
        hint: "recommended \u2014 versioned release or :latest"
      },
      {
        value: "dev",
        label: "Dev",
        hint: "latest development build (:dev tag)"
      }
    ]
  });
  if (Ct(channelChoice)) {
    Ne();
    process.exit(0);
  }
  const channel = channelChoice;
  let resolvedDir = "";
  let domainConfig = null;
  let dbConfig = null;
  let orgConfig = null;
  let adminConfig = null;
  let featuresConfig = null;
  let step = 0;
  const totalSteps = STEP_NAMES.length;
  while (step < totalSteps) {
    switch (step) {
      case 0: {
        R2.step(import_picocolors8.default.cyan(`Step 1/${totalSteps}`) + " Install Directory");
        const result = await stepInstallDir();
        if (result === BACK) {
          step = Math.max(0, step - 1);
          break;
        }
        resolvedDir = result;
        step++;
        break;
      }
      case 1: {
        domainConfig = await stepDomain();
        const nav = await confirmOrBack("Domain configured. Continue?");
        if (nav === BACK) {
          step--;
          break;
        }
        step++;
        break;
      }
      case 2: {
        dbConfig = await stepDatabase();
        const nav = await confirmOrBack("Database configured. Continue?");
        if (nav === BACK) {
          step--;
          break;
        }
        step++;
        break;
      }
      case 3: {
        orgConfig = await stepOrganization();
        const nav = await confirmOrBack("Organization configured. Continue?");
        if (nav === BACK) {
          step--;
          break;
        }
        step++;
        break;
      }
      case 4: {
        adminConfig = await stepAdmin();
        const nav = await confirmOrBack("Admin account configured. Continue?");
        if (nav === BACK) {
          step--;
          break;
        }
        step++;
        break;
      }
      case 5: {
        featuresConfig = await stepFeatures();
        step++;
        break;
      }
    }
  }
  const deploymentId = crypto3.randomBytes(4).toString("hex");
  const config = {
    deploymentId,
    installDir: resolvedDir,
    channel,
    ...domainConfig,
    ...dbConfig,
    ...orgConfig,
    ...adminConfig,
    ...featuresConfig
  };
  const protocol = config.useHttps ? "https" : "http";
  const portSuffix = config.useHttps && config.httpPort === 443 || !config.useHttps && config.httpPort === 80 ? "" : `:${config.httpPort}`;
  const url = `${protocol}://${config.domain}${portSuffix}`;
  R2.step("Configuration Summary");
  R2.message([
    `  ${import_picocolors8.default.dim("Directory:")}     ${resolvedDir}`,
    `  ${import_picocolors8.default.dim("Channel:")}       ${config.channel === "dev" ? import_picocolors8.default.yellow("Dev (:dev)") : import_picocolors8.default.green("Stable")}`,
    `  ${import_picocolors8.default.dim("URL:")}           ${url}`,
    `  ${import_picocolors8.default.dim("HTTPS:")}         ${config.autoSsl ? "Auto SSL (Caddy)" : config.useHttps ? "Manual" : "Disabled"}`,
    `  ${import_picocolors8.default.dim("Database:")}      ${config.useExternalDb ? "External" : config.useAiDatabase ? "Local (Docker, AI-enabled)" : "Local (Docker)"}`,
    `  ${import_picocolors8.default.dim("Redis:")}         ${config.useExternalRedis ? "External" : "Local (Docker)"}`,
    `  ${import_picocolors8.default.dim("Organization:")} ${config.orgName}`,
    `  ${import_picocolors8.default.dim("Admin:")}        ${config.adminEmail}`,
    `  ${import_picocolors8.default.dim("AI:")}           ${config.aiEnabled ? "Enabled" : "Disabled"}`,
    `  ${import_picocolors8.default.dim("Email:")}        ${config.emailEnabled ? "Enabled" : "Disabled"}`,
    `  ${import_picocolors8.default.dim("S3 Storage:")}   ${config.s3Enabled ? "Enabled" : "Disabled"}`,
    `  ${import_picocolors8.default.dim("Google OAuth:")} ${config.googleOAuthEnabled ? "Enabled" : "Disabled"}`,
    `  ${import_picocolors8.default.dim("Unsplash:")}     ${config.unsplashEnabled ? "Enabled" : "Disabled"}`
  ].join("\n"));
  let confirmed = false;
  while (!confirmed) {
    const action = await Je({
      message: "What would you like to do?",
      options: [
        { value: "confirm", label: "Proceed with this configuration" },
        { value: "edit", label: import_picocolors8.default.dim("Go back and edit a step") },
        { value: "cancel", label: import_picocolors8.default.dim("Cancel setup") }
      ]
    });
    if (Ct(action) || action === "cancel") {
      Ne("Setup cancelled.");
      process.exit(0);
    }
    if (action === "edit") {
      const stepChoice = await Je({
        message: "Which step do you want to edit?",
        options: STEP_NAMES.map((name, i) => ({ value: i, label: `${i + 1}. ${name}` }))
      });
      if (Ct(stepChoice)) continue;
      const idx = stepChoice;
      switch (idx) {
        case 0: {
          R2.step(import_picocolors8.default.cyan(`Step 1/${totalSteps}`) + " Install Directory");
          const result = await stepInstallDir();
          if (result !== BACK) {
            resolvedDir = result;
            config.installDir = result;
          }
          break;
        }
        case 1: {
          domainConfig = await stepDomain();
          Object.assign(config, domainConfig);
          break;
        }
        case 2: {
          dbConfig = await stepDatabase();
          Object.assign(config, dbConfig);
          break;
        }
        case 3: {
          orgConfig = await stepOrganization();
          Object.assign(config, orgConfig);
          break;
        }
        case 4: {
          adminConfig = await stepAdmin();
          Object.assign(config, adminConfig);
          break;
        }
        case 5: {
          featuresConfig = await stepFeatures();
          Object.assign(config, featuresConfig);
          break;
        }
      }
      const p2 = config.useHttps ? "https" : "http";
      const ps2 = config.useHttps && config.httpPort === 443 || !config.useHttps && config.httpPort === 80 ? "" : `:${config.httpPort}`;
      const url2 = `${p2}://${config.domain}${ps2}`;
      R2.step("Updated Configuration Summary");
      R2.message([
        `  ${import_picocolors8.default.dim("Directory:")}     ${config.installDir}`,
        `  ${import_picocolors8.default.dim("Channel:")}       ${config.channel === "dev" ? import_picocolors8.default.yellow("Dev (:dev)") : import_picocolors8.default.green("Stable")}`,
        `  ${import_picocolors8.default.dim("URL:")}           ${url2}`,
        `  ${import_picocolors8.default.dim("HTTPS:")}         ${config.autoSsl ? "Auto SSL (Caddy)" : config.useHttps ? "Manual" : "Disabled"}`,
        `  ${import_picocolors8.default.dim("Database:")}      ${config.useExternalDb ? "External" : config.useAiDatabase ? "Local (Docker, AI-enabled)" : "Local (Docker)"}`,
        `  ${import_picocolors8.default.dim("Redis:")}         ${config.useExternalRedis ? "External" : "Local (Docker)"}`,
        `  ${import_picocolors8.default.dim("Organization:")} ${config.orgName}`,
        `  ${import_picocolors8.default.dim("Admin:")}        ${config.adminEmail}`,
        `  ${import_picocolors8.default.dim("AI:")}           ${config.aiEnabled ? "Enabled" : "Disabled"}`,
        `  ${import_picocolors8.default.dim("Email:")}        ${config.emailEnabled ? "Enabled" : "Disabled"}`,
        `  ${import_picocolors8.default.dim("S3 Storage:")}   ${config.s3Enabled ? "Enabled" : "Disabled"}`,
        `  ${import_picocolors8.default.dim("Google OAuth:")} ${config.googleOAuthEnabled ? "Enabled" : "Disabled"}`,
        `  ${import_picocolors8.default.dim("Unsplash:")}     ${config.unsplashEnabled ? "Enabled" : "Disabled"}`
      ].join("\n"));
    } else {
      confirmed = true;
    }
  }
  const s0 = bt2();
  s0.start("Resolving LearnHouse image version");
  const { image: appImage, isLatest } = await resolveAppImage(config.channel);
  s0.stop(`Using image: ${appImage}`);
  if (isLatest) {
    R2.warn("No versioned image found \u2014 using :latest tag. Pin to a version for stability.");
  }
  const s = bt2();
  s.start("Generating configuration files");
  const finalDir = config.installDir;
  try {
    fs2.mkdirSync(finalDir, { recursive: true });
    fs2.mkdirSync(path2.join(finalDir, "extra"), { recursive: true });
    fs2.writeFileSync(path2.join(finalDir, "docker-compose.yml"), generateDockerCompose(config, appImage));
    fs2.writeFileSync(path2.join(finalDir, ".env"), generateEnvFile(config));
    if (config.autoSsl) {
      fs2.writeFileSync(path2.join(finalDir, "extra", "Caddyfile"), generateCaddyfile(config));
    } else {
      fs2.writeFileSync(path2.join(finalDir, "extra", "nginx.prod.conf"), generateNginxConf());
    }
    writeConfig(config);
  } catch (err) {
    s.stop("Failed to generate configuration files");
    R2.error(err?.message ?? String(err));
    process.exit(1);
  }
  s.stop("Configuration files generated");
  const startNow = await Re({
    message: "Start LearnHouse now?",
    initialValue: true
  });
  if (Ct(startNow)) {
    Ne();
    process.exit(0);
  }
  const finalProtocol = config.useHttps ? "https" : "http";
  const finalPortSuffix = config.useHttps && config.httpPort === 443 || !config.useHttps && config.httpPort === 80 ? "" : `:${config.httpPort}`;
  const finalUrl = `${finalProtocol}://${config.domain}${finalPortSuffix}`;
  if (startNow) {
    R2.step("Starting LearnHouse");
    const s2 = bt2();
    s2.start("Pulling images and starting services (this may take a few minutes)");
    try {
      dockerComposeUp(finalDir);
      s2.stop("Services started");
    } catch (err) {
      s2.stop("Failed to start services");
      R2.error("Docker Compose failed. Check the output above for details.");
      R2.info(`You can manually start with: cd ${finalDir} && docker compose up -d`);
      process.exit(1);
    }
    const s3 = bt2();
    s3.start("Waiting for LearnHouse to be ready (up to 3 minutes)");
    const healthy = await waitForHealth(`http://localhost:${config.httpPort}`);
    if (healthy) {
      s3.stop("LearnHouse is ready!");
    } else {
      s3.stop("Health check timed out");
      R2.warn("LearnHouse may still be starting. Check status with:");
      R2.message(`  cd ${finalDir} && docker compose ps`);
    }
    R2.success(import_picocolors8.default.green(import_picocolors8.default.bold("LearnHouse is installed!")));
    R2.message([
      "",
      `  ${import_picocolors8.default.cyan("URL:")}       ${finalUrl}`,
      `  ${import_picocolors8.default.cyan("Admin:")}     ${config.adminEmail}`,
      `  ${import_picocolors8.default.cyan("Password:")}  ${config.adminPassword}`,
      "",
      `  ${import_picocolors8.default.dim("Management commands:")}`,
      `  ${import_picocolors8.default.dim("$")} npx learnhouse start    ${import_picocolors8.default.dim("Start services")}`,
      `  ${import_picocolors8.default.dim("$")} npx learnhouse stop     ${import_picocolors8.default.dim("Stop services")}`,
      `  ${import_picocolors8.default.dim("$")} npx learnhouse logs     ${import_picocolors8.default.dim("View logs")}`,
      `  ${import_picocolors8.default.dim("$")} npx learnhouse config   ${import_picocolors8.default.dim("Show configuration")}`,
      `  ${import_picocolors8.default.dim("$")} npx learnhouse backup   ${import_picocolors8.default.dim("Backup & restore")}`,
      `  ${import_picocolors8.default.dim("$")} npx learnhouse deployments ${import_picocolors8.default.dim("Manage deployments")}`,
      `  ${import_picocolors8.default.dim("$")} npx learnhouse doctor   ${import_picocolors8.default.dim("Diagnose issues")}`,
      `  ${import_picocolors8.default.dim("$")} npx learnhouse shell    ${import_picocolors8.default.dim("Container shell")}`,
      ""
    ].join("\n"));
  } else {
    R2.info(`Files have been generated in ${finalDir}`);
    R2.message(`  Start later with: cd ${finalDir} && docker compose up -d`);
  }
  Le(import_picocolors8.default.dim("Happy teaching!"));
}

// src/commands/start.ts
var import_picocolors9 = __toESM(require_picocolors(), 1);
async function startCommand() {
  const dir = findInstallDir();
  const config = readConfig(dir);
  if (!config) {
    R2.error("No LearnHouse installation found in the current directory.");
    R2.info("Run `npx learnhouse` to set up a new installation.");
    process.exit(1);
  }
  We(import_picocolors9.default.cyan("Starting LearnHouse"));
  try {
    dockerComposeUp(config.installDir);
    R2.success("LearnHouse is running!");
  } catch {
    R2.error("Failed to start services. Check Docker output above.");
    process.exit(1);
  }
}

// src/commands/stop.ts
var import_picocolors10 = __toESM(require_picocolors(), 1);
async function stopCommand() {
  const dir = findInstallDir();
  const config = readConfig(dir);
  if (!config) {
    R2.error("No LearnHouse installation found in the current directory.");
    process.exit(1);
  }
  We(import_picocolors10.default.cyan("Stopping LearnHouse"));
  try {
    dockerComposeDown(config.installDir);
    R2.success("LearnHouse stopped.");
  } catch {
    R2.error("Failed to stop services. Check Docker output above.");
    process.exit(1);
  }
}

// src/commands/logs.ts
async function logsCommand() {
  const dir = findInstallDir();
  const config = readConfig(dir);
  R2.info("Streaming logs (Ctrl+C to stop)...");
  if (config?.installDir) {
    try {
      const { execSync: execSync6 } = await import("child_process");
      const ps = execSync6("docker compose ps -q", { cwd: config.installDir, stdio: "pipe" }).toString().trim();
      if (ps) {
        dockerComposeLogs(config.installDir);
        return;
      }
    } catch {
    }
  }
  const id = config?.deploymentId || autoDetectDeploymentId();
  if (!id) {
    R2.error("No LearnHouse containers found. Start services first.");
    process.exit(1);
  }
  const containers = listDeploymentContainers(id).filter((c) => c.status.toLowerCase().startsWith("up"));
  if (containers.length === 0) {
    R2.error("No running containers found. Start services first.");
    process.exit(1);
  }
  dockerLogsMulti(containers.map((c) => c.name));
}

// src/commands/config.ts
var import_picocolors11 = __toESM(require_picocolors(), 1);
async function configCommand() {
  const dir = findInstallDir();
  const config = readConfig(dir);
  if (!config) {
    R2.error("No LearnHouse installation found in the current directory.");
    process.exit(1);
  }
  We(import_picocolors11.default.cyan("LearnHouse Configuration"));
  const protocol = config.useHttps ? "https" : "http";
  const portSuffix = config.useHttps && config.httpPort === 443 || !config.useHttps && config.httpPort === 80 ? "" : `:${config.httpPort}`;
  R2.message([
    `  ${import_picocolors11.default.dim("Version:")}      ${config.version}`,
    `  ${import_picocolors11.default.dim("Created:")}      ${config.createdAt}`,
    `  ${import_picocolors11.default.dim("Directory:")}    ${config.installDir}`,
    `  ${import_picocolors11.default.dim("URL:")}          ${protocol}://${config.domain}${portSuffix}`,
    `  ${import_picocolors11.default.dim("Org slug:")}     ${config.orgSlug}`
  ].join("\n"));
  R2.info(import_picocolors11.default.dim(`Full config: ${dir}/learnhouse.config.json`));
  R2.info(import_picocolors11.default.dim(`Environment: ${config.installDir}/.env (contains secrets)`));
}

// src/commands/backup.ts
import fs3 from "fs";
import path3 from "path";
import { execSync as execSync2 } from "child_process";
var import_picocolors12 = __toESM(require_picocolors(), 1);
function resolveDbContainer(config) {
  const id = config.deploymentId || autoDetectDeploymentId();
  if (!id) return null;
  return `learnhouse-db-${id}`;
}
async function createBackup() {
  const installDir = findInstallDir();
  const config = readConfig(installDir);
  if (!config) {
    R2.error("No LearnHouse installation found. Run setup first.");
    process.exit(1);
  }
  if (config.useExternalDb) {
    R2.error("Backup is only supported for local (Docker) databases.");
    R2.info("For external databases, use your database provider's backup tools.");
    process.exit(1);
  }
  const dbContainer = resolveDbContainer(config);
  if (!dbContainer || !isContainerRunning(dbContainer)) {
    R2.error("Database container is not running. Start services first.");
    process.exit(1);
  }
  const timestamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
  const backupDir = path3.join(installDir, "backups");
  const backupName = `learnhouse-backup-${timestamp}`;
  const tmpDir = path3.join(backupDir, backupName);
  const archivePath = path3.join(backupDir, `${backupName}.tar.gz`);
  fs3.mkdirSync(tmpDir, { recursive: true });
  const s = bt2();
  s.start("Creating database dump");
  try {
    const dumpPath = path3.join(tmpDir, "database.sql");
    dockerExecToFile(
      dbContainer,
      "pg_dump -U learnhouse learnhouse",
      dumpPath
    );
    s.stop("Database dump created");
  } catch (err) {
    s.stop("Database dump failed");
    R2.error("Failed to create database dump. Check that the database is running.");
    fs3.rmSync(tmpDir, { recursive: true, force: true });
    process.exit(1);
  }
  const envPath = path3.join(installDir, ".env");
  if (fs3.existsSync(envPath)) {
    fs3.copyFileSync(envPath, path3.join(tmpDir, ".env"));
  }
  const s2 = bt2();
  s2.start("Creating archive");
  try {
    execSync2(`tar -czf "${archivePath}" -C "${backupDir}" "${backupName}"`, {
      stdio: "pipe"
    });
    s2.stop("Archive created");
  } catch {
    s2.stop("Archive creation failed");
    R2.error("Failed to create archive.");
    process.exit(1);
  }
  fs3.rmSync(tmpDir, { recursive: true, force: true });
  const stats = fs3.statSync(archivePath);
  const sizeMb = (stats.size / (1024 * 1024)).toFixed(1);
  R2.success(import_picocolors12.default.green(import_picocolors12.default.bold("Backup complete!")));
  R2.message([
    "",
    `  ${import_picocolors12.default.dim("File:")} ${archivePath}`,
    `  ${import_picocolors12.default.dim("Size:")} ${sizeMb} MB`,
    "",
    `  ${import_picocolors12.default.dim("Restore with:")} npx learnhouse backup --restore ${archivePath}`,
    ""
  ].join("\n"));
}
async function restoreBackup(archivePath) {
  if (!fs3.existsSync(archivePath)) {
    R2.error(`Backup file not found: ${archivePath}`);
    process.exit(1);
  }
  const installDir = findInstallDir();
  const config = readConfig(installDir);
  if (!config) {
    R2.error("No LearnHouse installation found. Run setup first.");
    process.exit(1);
  }
  if (config.useExternalDb) {
    R2.error("Restore is only supported for local (Docker) databases.");
    R2.info("For external databases, use your database provider's restore tools.");
    process.exit(1);
  }
  const dbContainer = resolveDbContainer(config);
  if (!dbContainer || !isContainerRunning(dbContainer)) {
    R2.error("Database container is not running. Start services first.");
    process.exit(1);
  }
  R2.warn(import_picocolors12.default.yellow("This will overwrite the current database with the backup data."));
  const confirm = await Re({
    message: "Are you sure you want to restore from this backup?",
    initialValue: false
  });
  if (Ct(confirm) || !confirm) {
    Ne("Restore cancelled.");
    process.exit(0);
  }
  const tmpDir = path3.join(installDir, ".restore-tmp");
  fs3.mkdirSync(tmpDir, { recursive: true });
  const s = bt2();
  s.start("Extracting backup archive");
  try {
    execSync2(`tar -xzf "${archivePath}" -C "${tmpDir}"`, { stdio: "pipe" });
    s.stop("Archive extracted");
  } catch {
    s.stop("Extraction failed");
    fs3.rmSync(tmpDir, { recursive: true, force: true });
    R2.error("Failed to extract backup archive.");
    process.exit(1);
  }
  const entries = fs3.readdirSync(tmpDir);
  const backupFolder = entries.find(
    (e2) => fs3.existsSync(path3.join(tmpDir, e2, "database.sql"))
  );
  if (!backupFolder) {
    R2.error("No database.sql found in the backup archive.");
    fs3.rmSync(tmpDir, { recursive: true, force: true });
    process.exit(1);
  }
  const dumpPath = path3.join(tmpDir, backupFolder, "database.sql");
  const s2 = bt2();
  s2.start("Restoring database");
  try {
    dockerExecFromFile(
      dbContainer,
      "psql -U learnhouse -d learnhouse",
      dumpPath
    );
    s2.stop("Database restored");
  } catch {
    s2.stop("Database restore failed");
    fs3.rmSync(tmpDir, { recursive: true, force: true });
    R2.error("Failed to restore database. The backup file may be corrupted.");
    process.exit(1);
  }
  const envBackup = path3.join(tmpDir, backupFolder, ".env");
  if (fs3.existsSync(envBackup)) {
    const restoreEnv = await Re({
      message: "Backup contains a .env file. Restore it? (overwrites current .env)",
      initialValue: false
    });
    if (!Ct(restoreEnv) && restoreEnv) {
      fs3.copyFileSync(envBackup, path3.join(installDir, ".env"));
      R2.info(".env file restored");
    }
  }
  fs3.rmSync(tmpDir, { recursive: true, force: true });
  R2.success(import_picocolors12.default.green(import_picocolors12.default.bold("Restore complete!")));
  R2.info("You may want to restart services: npx learnhouse stop && npx learnhouse start");
}
async function backupCommand(archivePath, options) {
  if (options?.restore && archivePath) {
    We(import_picocolors12.default.cyan("LearnHouse Restore"));
    await restoreBackup(archivePath);
    return;
  }
  We(import_picocolors12.default.cyan("LearnHouse Backup"));
  const action = await Je({
    message: "What would you like to do?",
    options: [
      { value: "create", label: "Create a backup" },
      { value: "restore", label: "Restore from a backup" }
    ]
  });
  if (Ct(action)) {
    Ne();
    process.exit(0);
  }
  if (action === "create") {
    await createBackup();
  } else {
    const filePath = await text({
      message: "Path to backup archive (.tar.gz)",
      placeholder: "./backups/learnhouse-backup-*.tar.gz"
    });
    if (Ct(filePath)) {
      Ne();
      process.exit(0);
    }
    await restoreBackup(filePath);
  }
}

// src/commands/deployments.ts
import fs4 from "fs";
import path4 from "path";
import { execSync as execSync3 } from "child_process";
var import_picocolors13 = __toESM(require_picocolors(), 1);
var SERVICES = ["learnhouse-app", "db", "redis"];
function showDeployments() {
  let psOutput;
  try {
    psOutput = execSync3(
      'docker ps -a --filter "name=learnhouse-app-" --format "{{.Names}}\\t{{.Status}}\\t{{.Image}}"',
      { stdio: "pipe" }
    ).toString().trim();
  } catch {
    R2.error("Failed to query Docker. Is Docker running?");
    process.exit(1);
  }
  if (!psOutput) {
    R2.info("No LearnHouse deployments found.");
    R2.message(import_picocolors13.default.dim("  Run npx learnhouse setup to create one."));
    return;
  }
  const deployments = /* @__PURE__ */ new Map();
  let allOutput;
  try {
    allOutput = execSync3(
      'docker ps -a --filter "name=learnhouse-" --format "{{.Names}}\\t{{.Status}}\\t{{.Image}}"',
      { stdio: "pipe" }
    ).toString().trim();
  } catch {
    allOutput = psOutput;
  }
  for (const line of allOutput.split("\n")) {
    if (!line.trim()) continue;
    const [name, status, image] = line.split("	");
    const match = name.match(/learnhouse-\w+-([a-f0-9]+)$/);
    if (!match) continue;
    const id = match[1];
    if (!deployments.has(id)) {
      deployments.set(id, { id, containers: [] });
    }
    deployments.get(id).containers.push({ name, status, image });
  }
  R2.info(`Found ${import_picocolors13.default.bold(String(deployments.size))} deployment${deployments.size === 1 ? "" : "s"}`);
  console.log();
  for (const [id, dep] of deployments) {
    const running = dep.containers.filter((c) => c.status.toLowerCase().startsWith("up")).length;
    const total = dep.containers.length;
    const statusColor = running === total ? import_picocolors13.default.green : running > 0 ? import_picocolors13.default.yellow : import_picocolors13.default.red;
    const statusText = statusColor(`${running}/${total} running`);
    console.log(`  ${import_picocolors13.default.bold(import_picocolors13.default.white(`Deployment ${id}`))}  ${statusText}`);
    console.log();
    for (const c of dep.containers) {
      const isUp = c.status.toLowerCase().startsWith("up");
      const icon = isUp ? import_picocolors13.default.green("\u25CF") : import_picocolors13.default.red("\u25CF");
      const svcName = c.name.replace(`-${id}`, "");
      console.log(`    ${icon}  ${import_picocolors13.default.white(svcName.padEnd(24))} ${import_picocolors13.default.dim(c.status)}`);
    }
    console.log();
  }
}
function parseMemLimit(composePath) {
  const content = fs4.readFileSync(composePath, "utf-8");
  const limits = /* @__PURE__ */ new Map();
  let currentService = null;
  let inServices = false;
  for (const line of content.split("\n")) {
    if (line.match(/^services:\s*$/)) {
      inServices = true;
      continue;
    }
    if (inServices && line.match(/^  \w/) && line.includes(":")) {
      const match = line.match(/^\s{2}(\S+):/);
      currentService = match ? match[1] : null;
    }
    if (currentService && line.match(/^\s+mem_limit:/)) {
      const value = line.split(":")[1].trim();
      limits.set(currentService, value);
    }
  }
  return limits;
}
function setMemLimit(content, service, limit) {
  const lines = content.split("\n");
  const result = [];
  let currentService = null;
  let inServices = false;
  let serviceIndent = 0;
  let insertedForService = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.match(/^services:\s*$/)) {
      inServices = true;
      result.push(line);
      continue;
    }
    if (inServices && line.match(/^  \w/) && line.includes(":")) {
      const match = line.match(/^(\s{2})(\S+):/);
      if (match) {
        currentService = match[2];
        serviceIndent = match[1].length;
        insertedForService = false;
      }
    }
    if (currentService === service && line.match(/^\s+mem_limit:/)) {
      result.push(line.replace(/mem_limit:.*/, `mem_limit: ${limit}`));
      insertedForService = true;
      continue;
    }
    if (currentService === service && !insertedForService && line.match(/^\s+container_name:/)) {
      result.push(line);
      result.push(`${" ".repeat(serviceIndent + 2)}mem_limit: ${limit}`);
      insertedForService = true;
      continue;
    }
    result.push(line);
  }
  return result.join("\n");
}
async function scaleResources() {
  const dir = findInstallDir();
  const config = readConfig(dir);
  if (!config) {
    R2.error("No LearnHouse installation found. Run setup first.");
    process.exit(1);
  }
  R2.step("Current Resource Usage");
  try {
    const stats = dockerStats(config.installDir);
    R2.message(import_picocolors13.default.dim(stats.trim()));
  } catch {
    try {
      const id = config.deploymentId || autoDetectDeploymentId();
      const running = listDeploymentContainers(id || void 0).filter((c) => c.status.toLowerCase().startsWith("up")).map((c) => c.name);
      if (running.length > 0) {
        const stats = dockerStatsForContainers(running);
        R2.message(import_picocolors13.default.dim(stats.trim()));
      } else {
        R2.warn("No running containers found.");
      }
    } catch {
      R2.warn("Could not retrieve current stats. Services may not be running.");
    }
  }
  const composePath = path4.join(config.installDir || dir, "docker-compose.yml");
  if (!fs4.existsSync(composePath)) {
    R2.error("docker-compose.yml not found.");
    process.exit(1);
  }
  let composeContent = fs4.readFileSync(composePath, "utf-8");
  const currentLimits = parseMemLimit(composePath);
  R2.step("Set Memory Limits");
  R2.info(import_picocolors13.default.dim("Examples: 256m, 512m, 1g, 2g (leave empty to skip)"));
  let changed = false;
  for (const service of SERVICES) {
    const current = currentLimits.get(service);
    const label = current ? `Memory limit for ${import_picocolors13.default.bold(service)} (current: ${current})` : `Memory limit for ${import_picocolors13.default.bold(service)} (not set)`;
    const value = await text({
      message: label,
      placeholder: current ? void 0 : "e.g. 512m",
      defaultValue: current || ""
    });
    if (Ct(value)) {
      Ne();
      process.exit(0);
    }
    const trimmed = value.trim();
    if (trimmed && trimmed.match(/^\d+[mgMG]$/)) {
      composeContent = setMemLimit(composeContent, service, trimmed);
      changed = true;
      R2.success(`${service}: ${trimmed}`);
    } else if (trimmed) {
      R2.warn(`Invalid format "${trimmed}" \u2014 skipping. Use format like 512m or 1g.`);
    }
  }
  if (!changed) {
    R2.info("No changes made.");
    return;
  }
  fs4.writeFileSync(composePath, composeContent);
  R2.success("docker-compose.yml updated");
  const restart = await Re({
    message: "Restart services to apply limits?",
    initialValue: false
  });
  if (!Ct(restart) && restart) {
    const s = bt2();
    s.start("Restarting services");
    try {
      dockerComposeDown(config.installDir);
      dockerComposeUp(config.installDir);
      s.stop("Services restarted");
    } catch {
      s.stop("Restart failed");
      R2.error("Failed to restart services. Check Docker output above.");
    }
  }
}
async function deploymentsCommand() {
  We(import_picocolors13.default.cyan("LearnHouse Deployments"));
  const action = await Je({
    message: "What would you like to do?",
    options: [
      { value: "view", label: "View deployments" },
      { value: "scale", label: "Set resource limits" }
    ]
  });
  if (Ct(action)) {
    Ne();
    process.exit(0);
  }
  if (action === "view") {
    showDeployments();
  } else {
    await scaleResources();
  }
  Le(import_picocolors13.default.dim("Done"));
}

// src/commands/doctor.ts
import fs5 from "fs";
import path5 from "path";
import { execSync as execSync4 } from "child_process";
var import_picocolors14 = __toESM(require_picocolors(), 1);
function pass(msg) {
  console.log(`  ${import_picocolors14.default.green("\u2713")} ${msg}`);
}
function warn(msg, fix) {
  console.log(`  ${import_picocolors14.default.yellow("!")} ${msg}`);
  if (fix) console.log(`    ${import_picocolors14.default.dim(`Fix: ${fix}`)}`);
}
function fail(msg, fix) {
  console.log(`  ${import_picocolors14.default.red("\u2717")} ${msg}`);
  if (fix) console.log(`    ${import_picocolors14.default.dim(`Fix: ${fix}`)}`);
}
var REQUIRED_ENV_VARS = [
  "LEARNHOUSE_DOMAIN",
  "LEARNHOUSE_SQL_CONNECTION_STRING",
  "LEARNHOUSE_REDIS_CONNECTION_STRING",
  "LEARNHOUSE_AUTH_JWT_SECRET_KEY",
  "NEXTAUTH_SECRET",
  "NEXTAUTH_URL"
];
var SECRET_ENV_VARS = [
  "LEARNHOUSE_AUTH_JWT_SECRET_KEY",
  "NEXTAUTH_SECRET",
  "POSTGRES_PASSWORD"
];
async function doctorCommand() {
  const dir = findInstallDir();
  const config = readConfig(dir);
  We(import_picocolors14.default.cyan("LearnHouse Doctor"));
  R2.step("Docker Environment");
  if (!isDockerInstalled()) {
    fail("Docker not installed", "Install Docker: https://docs.docker.com/get-docker/");
    Le(import_picocolors14.default.red("Cannot continue without Docker"));
    process.exit(1);
  }
  pass("Docker installed");
  if (!isDockerRunning()) {
    fail("Docker daemon not running", "Start Docker Desktop or run: sudo systemctl start docker");
    Le(import_picocolors14.default.red("Cannot continue without Docker running"));
    process.exit(1);
  }
  pass("Docker daemon running");
  if (isDockerComposeV2()) {
    pass("Docker Compose v2 available");
  } else {
    fail("Docker Compose v2 not found", "Update Docker Desktop or install docker-compose-plugin");
  }
  if (!config) {
    R2.warn("No LearnHouse installation found. Skipping deployment checks.");
    Le(import_picocolors14.default.dim("Done"));
    return;
  }
  const id = config.deploymentId || autoDetectDeploymentId();
  const installDir = dir;
  if (!id) {
    R2.warn("No deployment ID found. Skipping container checks.");
    Le(import_picocolors14.default.dim("Done"));
    return;
  }
  R2.step("Containers");
  const containers = listDeploymentContainers(id);
  if (containers.length === 0) {
    warn("No containers found", "Run: npx learnhouse start");
  } else {
    for (const c of containers) {
      const isUp = c.status.toLowerCase().startsWith("up");
      const svcName = c.name.replace(`-${id}`, "");
      if (isUp) {
        pass(`${svcName} running`);
      } else if (c.status.toLowerCase().includes("restarting")) {
        fail(`${svcName} is restarting`, "Check logs: npx learnhouse logs");
      } else {
        fail(`${svcName} \u2014 ${c.status}`, "Run: npx learnhouse start");
      }
    }
  }
  R2.step("Restart Counts");
  for (const c of containers) {
    const count = getContainerRestartCount(c.name);
    const svcName = c.name.replace(`-${id}`, "");
    if (count > 3) {
      warn(`${svcName} has restarted ${count} times`, "Check container logs for crash reasons");
    } else {
      pass(`${svcName} \u2014 ${count} restarts`);
    }
  }
  R2.step("Network");
  const portFree = await checkPort(config.httpPort);
  if (portFree) {
    pass(`Port ${config.httpPort} is available`);
  } else {
    const hasRunning = containers.some((c) => c.status.toLowerCase().startsWith("up"));
    if (hasRunning) {
      pass(`Port ${config.httpPort} in use (by LearnHouse services)`);
    } else {
      warn(`Port ${config.httpPort} is in use by another process`, `Free the port or change HTTP_PORT in .env`);
    }
  }
  if (config.domain !== "localhost" && !config.domain.startsWith("127.")) {
    try {
      const { promises: dns } = await import("dns");
      await dns.resolve(config.domain);
      pass(`DNS resolves for ${config.domain}`);
    } catch {
      warn(`DNS resolution failed for ${config.domain}`, "Check your DNS settings or /etc/hosts");
    }
  }
  R2.step("Disk");
  try {
    const dfOutput = execSync4("df -h . | tail -1 | awk '{print $4}'", {
      stdio: "pipe",
      cwd: installDir
    }).toString().trim();
    const sizeStr = dfOutput.toLowerCase();
    const numericVal = parseFloat(sizeStr);
    if (sizeStr.includes("g") && numericVal < 1) {
      warn(`Low disk space: ${dfOutput} available`, "Free up disk space or docker system prune");
    } else if (sizeStr.includes("m")) {
      warn(`Low disk space: ${dfOutput} available`, "Free up disk space or docker system prune");
    } else {
      pass(`Disk space available: ${dfOutput}`);
    }
  } catch {
    warn("Could not check disk space");
  }
  try {
    const diskUsage = getDockerDiskUsage();
    R2.message(import_picocolors14.default.dim(diskUsage.trim()));
  } catch {
  }
  R2.step("Log Analysis");
  const errorPatterns = /ERROR|FATAL|Traceback/i;
  for (const c of containers) {
    if (!isContainerRunning(c.name)) continue;
    try {
      const logs = getContainerLogs(c.name, 50);
      const errorLines = logs.split("\n").filter((l) => errorPatterns.test(l));
      const svcName = c.name.replace(`-${id}`, "");
      if (errorLines.length > 0) {
        warn(`${svcName} \u2014 ${errorLines.length} error(s) in last 50 log lines`);
        for (const line of errorLines.slice(0, 3)) {
          console.log(`    ${import_picocolors14.default.dim(line.trim().slice(0, 120))}`);
        }
      } else {
        pass(`${svcName} \u2014 no errors in recent logs`);
      }
    } catch {
      warn(`Could not read logs for ${c.name}`);
    }
  }
  R2.step("Environment File");
  const envPath = path5.join(installDir, ".env");
  if (!fs5.existsSync(envPath)) {
    fail(".env file missing", "Run setup again: npx learnhouse setup");
  } else {
    const envContent = fs5.readFileSync(envPath, "utf-8");
    const envMap = /* @__PURE__ */ new Map();
    for (const line of envContent.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      envMap.set(trimmed.slice(0, eqIdx), trimmed.slice(eqIdx + 1));
    }
    let envOk = true;
    for (const key of REQUIRED_ENV_VARS) {
      if (!envMap.has(key) || !envMap.get(key)) {
        fail(`Missing or empty: ${key}`);
        envOk = false;
      }
    }
    for (const key of SECRET_ENV_VARS) {
      const val = envMap.get(key) || "";
      if (val && val.length < 8) {
        warn(`${key} seems too short (${val.length} chars)`, "Use a stronger secret");
        envOk = false;
      }
    }
    if (envOk) {
      pass("All required environment variables present");
    }
  }
  R2.step("Image Freshness");
  for (const c of containers) {
    try {
      const localDigest = execSync4(
        `docker inspect --format '{{.Image}}' ${c.name}`,
        { stdio: "pipe" }
      ).toString().trim();
      const svcName = c.name.replace(`-${id}`, "");
      pass(`${svcName} \u2014 image: ${localDigest.slice(7, 19)}`);
    } catch {
    }
  }
  console.log();
  Le(import_picocolors14.default.dim("Diagnosis complete"));
}

// src/commands/shell.ts
var import_picocolors15 = __toESM(require_picocolors(), 1);
async function shellCommand() {
  const dir = findInstallDir();
  const config = readConfig(dir);
  if (!config) {
    R2.error("No LearnHouse installation found. Run setup first.");
    process.exit(1);
  }
  const id = config.deploymentId || autoDetectDeploymentId();
  if (!id) {
    R2.error("No deployment found. Start services first.");
    process.exit(1);
  }
  const containers = listDeploymentContainers(id).filter((c) => c.status.toLowerCase().startsWith("up"));
  if (containers.length === 0) {
    R2.error("No running containers found. Start services first.");
    process.exit(1);
  }
  const selected = await Je({
    message: "Select a container",
    options: containers.map((c) => ({
      value: c.name,
      label: `${c.name.replace(`-${id}`, "")} ${import_picocolors15.default.dim(`(${c.name})`)}`
    }))
  });
  if (Ct(selected)) {
    Ne();
    process.exit(0);
  }
  R2.info(`Connecting to ${selected}... (type "exit" to leave)`);
  dockerExecInteractive(selected, "/bin/sh");
}

// src/commands/dev.ts
import { spawn as spawn2, spawnSync as spawnSync2, execSync as execSync5 } from "child_process";
var import_picocolors17 = __toESM(require_picocolors(), 1);
import * as path7 from "path";
import * as fs7 from "fs";

// src/services/env-check.ts
import * as fs6 from "fs";
import * as path6 from "path";
import * as crypto4 from "crypto";
var import_picocolors16 = __toESM(require_picocolors(), 1);
function generateJwtSecret() {
  return crypto4.randomBytes(32).toString("base64url");
}
var API_ENV = {
  label: "API",
  envFile: "apps/api/.env",
  vars: [
    {
      name: "LEARNHOUSE_AUTH_JWT_SECRET_KEY",
      required: true,
      description: "JWT signing secret (min 32 chars)",
      defaultValue: generateJwtSecret
    },
    {
      name: "COLLAB_INTERNAL_KEY",
      required: true,
      description: "Shared key for collab \u2194 API auth",
      defaultValue: "dev-collab-internal-key-change-in-prod"
    }
  ]
};
var WEB_ENV = {
  label: "Web",
  envFile: "apps/web/.env.local",
  vars: [
    {
      name: "NEXT_PUBLIC_LEARNHOUSE_BACKEND_URL",
      required: true,
      description: "Backend API URL",
      defaultValue: "http://localhost:1338/"
    }
  ]
};
var COLLAB_ENV = {
  label: "Collab",
  envFile: "apps/collab/.env",
  vars: [
    {
      name: "COLLAB_PORT",
      required: true,
      description: "WebSocket server port",
      defaultValue: "4000"
    },
    {
      name: "LEARNHOUSE_API_URL",
      required: true,
      description: "LearnHouse API base URL",
      defaultValue: "http://localhost:1338"
    },
    {
      name: "LEARNHOUSE_AUTH_JWT_SECRET_KEY",
      required: true,
      description: "JWT secret (must match API)",
      defaultValue: ""
      // filled from API value at write-time
    },
    {
      name: "COLLAB_INTERNAL_KEY",
      required: true,
      description: "Internal key (must match API)",
      defaultValue: ""
      // filled from API value at write-time
    }
  ]
};
var ALL_APPS = [API_ENV, WEB_ENV, COLLAB_ENV];
function parseEnvFile(filePath) {
  const vars = /* @__PURE__ */ new Map();
  if (!fs6.existsSync(filePath)) return vars;
  for (const line of fs6.readFileSync(filePath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"') || value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }
    const cIdx = value.indexOf(" #");
    if (cIdx !== -1) value = value.slice(0, cIdx).trim();
    vars.set(key, value);
  }
  return vars;
}
function appendToEnvFile(filePath, newVars) {
  let content = "";
  if (fs6.existsSync(filePath)) {
    content = fs6.readFileSync(filePath, "utf-8");
    if (content.length > 0 && !content.endsWith("\n")) content += "\n";
  }
  for (const [key, value] of newVars) {
    content += `${key}=${value}
`;
  }
  const dir = path6.dirname(filePath);
  if (!fs6.existsSync(dir)) fs6.mkdirSync(dir, { recursive: true });
  fs6.writeFileSync(filePath, content);
}
function resolveDefault(v) {
  return typeof v.defaultValue === "function" ? v.defaultValue() : v.defaultValue;
}
async function checkDevEnv(root) {
  const missing = [];
  for (const app of ALL_APPS) {
    const existing = parseEnvFile(path6.join(root, app.envFile));
    for (const v of app.vars) {
      const val = existing.get(v.name);
      if (v.required && (!val || val.length === 0)) {
        missing.push({ app, envVar: v });
      }
    }
  }
  if (missing.length === 0) {
    R2.success("Environment files look good");
    return true;
  }
  R2.warning(`Found ${missing.length} missing env variable${missing.length > 1 ? "s" : ""}:`);
  console.log();
  const byApp = /* @__PURE__ */ new Map();
  for (const m of missing) {
    const list = byApp.get(m.app.label) ?? [];
    list.push(m);
    byApp.set(m.app.label, list);
  }
  for (const [label, vars] of byApp) {
    console.log(`  ${import_picocolors16.default.bold(label)} ${import_picocolors16.default.dim(`(${vars[0].app.envFile})`)}`);
    for (const m of vars) {
      console.log(`    ${import_picocolors16.default.red("\u2717")} ${import_picocolors16.default.cyan(m.envVar.name)} \u2014 ${import_picocolors16.default.dim(m.envVar.description)}`);
    }
    console.log();
  }
  const action = await Je({
    message: "How would you like to proceed?",
    options: [
      { value: "defaults", label: "Apply dev defaults and continue", hint: "writes only the missing vars" },
      { value: "abort", label: "Abort \u2014 I'll set them up manually" }
    ]
  });
  if (Ct(action) || action === "abort") {
    R2.info("Set the missing variables and run the command again.");
    return false;
  }
  const apiFile = path6.join(root, API_ENV.envFile);
  const apiExisting = parseEnvFile(apiFile);
  const jwtSecret = apiExisting.get("LEARNHOUSE_AUTH_JWT_SECRET_KEY") || generateJwtSecret();
  const collabKey = apiExisting.get("COLLAB_INTERNAL_KEY") || "dev-collab-internal-key-change-in-prod";
  for (const app of ALL_APPS) {
    const filePath = path6.join(root, app.envFile);
    const existing = parseEnvFile(filePath);
    const toWrite = /* @__PURE__ */ new Map();
    for (const v of app.vars) {
      const val = existing.get(v.name);
      if (!v.required || val && val.length > 0) continue;
      if (v.name === "LEARNHOUSE_AUTH_JWT_SECRET_KEY") {
        toWrite.set(v.name, jwtSecret);
      } else if (v.name === "COLLAB_INTERNAL_KEY") {
        toWrite.set(v.name, collabKey);
      } else {
        toWrite.set(v.name, resolveDefault(v));
      }
    }
    if (toWrite.size > 0) {
      appendToEnvFile(filePath, toWrite);
      const names = [...toWrite.keys()].map((k2) => import_picocolors16.default.cyan(k2)).join(", ");
      R2.success(`${import_picocolors16.default.bold(app.label)}: wrote ${names} \u2192 ${import_picocolors16.default.dim(app.envFile)}`);
    }
  }
  console.log();
  return true;
}

// src/commands/dev.ts
var PROJECT_NAME = "learnhouse-dev";
var DEV_COMPOSE = `name: learnhouse-dev

services:
  db:
    image: pgvector/pgvector:pg16
    container_name: learnhouse-db-dev
    restart: unless-stopped
    environment:
      - POSTGRES_USER=learnhouse
      - POSTGRES_PASSWORD=learnhouse
      - POSTGRES_DB=learnhouse
    ports:
      - "5432:5432"
    volumes:
      - learnhouse_db_dev_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U learnhouse"]
      interval: 5s
      timeout: 4s
      retries: 5

  redis:
    image: redis:8.6.1-alpine
    container_name: learnhouse-redis-dev
    restart: unless-stopped
    command: redis-server --appendonly yes
    ports:
      - "6379:6379"
    volumes:
      - learnhouse_redis_dev_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 4s
      retries: 5

volumes:
  learnhouse_db_dev_data:
  learnhouse_redis_dev_data:
`;
function findProjectRoot() {
  let dir = process.cwd();
  while (true) {
    if (fs7.existsSync(path7.join(dir, "apps", "api")) && fs7.existsSync(path7.join(dir, "apps", "web"))) {
      return dir;
    }
    const parent = path7.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
function getDevComposePath(root) {
  const dotDir = path7.join(root, ".learnhouse");
  if (!fs7.existsSync(dotDir)) fs7.mkdirSync(dotDir, { recursive: true });
  const composePath = path7.join(dotDir, "docker-compose.dev.yml");
  fs7.writeFileSync(composePath, DEV_COMPOSE);
  return composePath;
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function waitForHealth2(label, command, args, maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      execSync5([command, ...args].join(" "), { stdio: "pipe", timeout: 5e3 });
      return true;
    } catch {
      await sleep(1e3);
    }
  }
  return false;
}
var CONTROLS_BAR = import_picocolors17.default.dim("\u2500".repeat(60)) + "\n" + import_picocolors17.default.dim("  ") + import_picocolors17.default.bold("ra") + import_picocolors17.default.dim(" restart api  ") + import_picocolors17.default.bold("rw") + import_picocolors17.default.dim(" restart web  ") + import_picocolors17.default.bold("rc") + import_picocolors17.default.dim(" restart collab  ") + import_picocolors17.default.bold("rb") + import_picocolors17.default.dim(" restart all  ") + import_picocolors17.default.bold("q") + import_picocolors17.default.dim(" quit") + "\n" + import_picocolors17.default.dim("\u2500".repeat(60));
var lineCount = 0;
var CONTROLS_INTERVAL = 50;
function printControls() {
  process.stdout.write("\n" + CONTROLS_BAR + "\n\n");
  lineCount = 0;
}
function prefixStream(proc, label, color) {
  const prefix = color(`[${label}]`);
  const handleData = (data) => {
    const lines = data.toString().split("\n");
    for (const line of lines) {
      if (line.length > 0) {
        process.stdout.write(`${prefix} ${line}
`);
        lineCount++;
        if (lineCount >= CONTROLS_INTERVAL) {
          printControls();
        }
      }
    }
  };
  proc.stdout?.on("data", handleData);
  proc.stderr?.on("data", handleData);
}
function isContainerRunning2(name) {
  try {
    const state = execSync5(
      `docker inspect --format '{{.State.Running}}' ${name}`,
      { stdio: "pipe" }
    ).toString().trim();
    return state === "true";
  } catch {
    return false;
  }
}
function isInfraRunning() {
  return isContainerRunning2("learnhouse-db-dev") && isContainerRunning2("learnhouse-redis-dev");
}
var serviceEnv = {};
function spawnService(command, args, cwd, label, color) {
  const localBin = path7.join(cwd, "node_modules", ".bin");
  const child = spawn2(command, args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      ...serviceEnv,
      PATH: `${localBin}:${process.env.PATH ?? ""}`
    }
  });
  prefixStream(child, label, color);
  child.on("exit", (code) => {
    if (code !== null && code !== 0) {
      console.log(color(`[${label}]`) + ` exited with code ${code}`);
    }
  });
  return child;
}
function killProcess(child) {
  return new Promise((resolve) => {
    if (!child || child.killed || child.exitCode !== null) {
      resolve();
      return;
    }
    child.on("exit", () => resolve());
    child.kill("SIGTERM");
    setTimeout(() => {
      if (!child.killed && child.exitCode === null) {
        child.kill("SIGKILL");
      }
    }, 5e3);
  });
}
async function devCommand(opts) {
  const root = findProjectRoot();
  if (!root) {
    R2.error("Not inside a LearnHouse project.");
    R2.info("Run this command from within the learnhouse monorepo (must contain dev/docker-compose.yml, apps/api/, and apps/web/).");
    process.exit(1);
  }
  We(import_picocolors17.default.cyan("LearnHouse Dev Mode"));
  const envOk = await checkDevEnv(root);
  if (!envOk) process.exit(1);
  const eePath = path7.join(root, "apps", "api", "ee");
  const eeDisabledPath = path7.join(root, "apps", "api", ".ee-disabled");
  let eeWasHidden = false;
  if (fs7.existsSync(eeDisabledPath) && !fs7.existsSync(eePath)) {
    fs7.renameSync(eeDisabledPath, eePath);
  }
  if (!opts.ee && fs7.existsSync(eePath)) {
    fs7.renameSync(eePath, eeDisabledPath);
    eeWasHidden = true;
  } else if (opts.ee) {
    if (fs7.existsSync(eePath)) {
      R2.info(`Running in ${import_picocolors17.default.bold("EE")} mode`);
    } else {
      R2.warning("--ee was passed but no ee/ folder found \u2014 running in OSS mode");
    }
  }
  if (!isDockerInstalled()) {
    R2.error("Docker is not installed. Please install Docker and try again.");
    process.exit(1);
  }
  if (!isDockerRunning()) {
    R2.error("Docker is not running. Please start Docker and try again.");
    process.exit(1);
  }
  console.log();
  const composePath = getDevComposePath(root);
  const alreadyRunning = isInfraRunning();
  if (alreadyRunning) {
    R2.success("Existing DB and Redis containers detected \u2014 reusing them");
  }
  if (!alreadyRunning) {
    const email = await text({
      message: "Admin email",
      placeholder: "admin@school.dev",
      defaultValue: "admin@school.dev"
    });
    if (Ct(email)) process.exit(0);
    const password = await He({
      message: "Admin password"
    });
    if (Ct(password)) process.exit(0);
    if (!password) {
      R2.error("Password is required.");
      process.exit(1);
    }
    serviceEnv = {
      FORCE_COLOR: "1",
      LEARNHOUSE_INITIAL_ADMIN_EMAIL: email,
      LEARNHOUSE_INITIAL_ADMIN_PASSWORD: password
    };
    const infraSpinner = bt2();
    infraSpinner.start("Starting DB and Redis containers...");
    try {
      execSync5(`docker compose -f ${composePath} -p ${PROJECT_NAME} up -d`, {
        cwd: root,
        stdio: "pipe"
      });
      infraSpinner.stop("Containers started");
    } catch (e2) {
      infraSpinner.stop("Failed to start containers");
      R2.error(e2.stderr?.toString() || "docker compose up failed");
      process.exit(1);
    }
  } else {
    serviceEnv = {
      FORCE_COLOR: "1"
    };
  }
  const healthSpinner = bt2();
  healthSpinner.start("Waiting for DB and Redis to be healthy...");
  const [dbReady, redisReady] = await Promise.all([
    waitForHealth2("DB", "docker", ["exec", "learnhouse-db-dev", "pg_isready", "-U", "learnhouse"]),
    waitForHealth2("Redis", "docker", ["exec", "learnhouse-redis-dev", "redis-cli", "ping"])
  ]);
  if (!dbReady || !redisReady) {
    healthSpinner.stop("Health checks failed");
    if (!dbReady) R2.error("Database did not become ready in time.");
    if (!redisReady) R2.error("Redis did not become ready in time.");
    process.exit(1);
  }
  healthSpinner.stop("DB and Redis are healthy");
  const webDir = path7.join(root, "apps", "web");
  const collabDir = path7.join(root, "apps", "collab");
  const apiDir = path7.join(root, "apps", "api");
  const bunProjects = [
    { label: "web", dir: webDir },
    { label: "collab", dir: collabDir }
  ];
  for (const { label, dir } of bunProjects) {
    if (!fs7.existsSync(path7.join(dir, "node_modules"))) {
      R2.info(`Installing ${label} dependencies...`);
      const result = spawnSync2("bun", ["install"], { cwd: dir, stdio: "inherit", shell: true });
      if (result.status !== 0) {
        R2.error(`Failed to install ${label} dependencies`);
        process.exit(1);
      }
    }
  }
  if (!fs7.existsSync(path7.join(apiDir, ".venv"))) {
    R2.info("Installing API dependencies...");
    const result = spawnSync2("uv", ["sync"], { cwd: apiDir, stdio: "inherit", shell: true });
    if (result.status !== 0) {
      R2.error("Failed to install API dependencies");
      process.exit(1);
    }
  }
  let apiProc = null;
  let webProc = null;
  let collabProc = null;
  const startApi = () => {
    return spawnService("uv", ["run", "python", "app.py"], path7.join(root, "apps", "api"), "api", import_picocolors17.default.magenta);
  };
  const startWeb = () => {
    return spawnService("next", ["dev", "--turbopack"], path7.join(root, "apps", "web"), "web", import_picocolors17.default.cyan);
  };
  const startCollab = () => {
    return spawnService("tsx", ["watch", "src/index.ts"], path7.join(root, "apps", "collab"), "collab", import_picocolors17.default.yellow);
  };
  apiProc = startApi();
  webProc = startWeb();
  collabProc = startCollab();
  R2.success("API, Web, and Collab servers started");
  console.log();
  console.log(import_picocolors17.default.dim("  Thank you for contributing to LearnHouse!"));
  console.log();
  printControls();
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log("\n" + import_picocolors17.default.dim("Shutting down dev servers..."));
    if (process.stdin.isTTY && process.stdin.isRaw) {
      process.stdin.setRawMode(false);
    }
    process.stdin.pause();
    await Promise.all([killProcess(apiProc), killProcess(webProc), killProcess(collabProc)]);
    if (eeWasHidden && fs7.existsSync(eeDisabledPath) && !fs7.existsSync(eePath)) {
      fs7.renameSync(eeDisabledPath, eePath);
    }
    console.log(import_picocolors17.default.dim("DB and Redis containers are still running for next session."));
    console.log(import_picocolors17.default.dim("To stop them: docker compose -f .learnhouse/docker-compose.dev.yml -p learnhouse-dev down"));
    console.log(import_picocolors17.default.dim("Thanks for building with LearnHouse!"));
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    let pendingR = false;
    process.stdin.on("data", async (key) => {
      if (key === "") {
        await shutdown();
        return;
      }
      if (key === "q") {
        await shutdown();
        return;
      }
      if (key === "r") {
        pendingR = true;
        setTimeout(() => {
          pendingR = false;
        }, 1e3);
        return;
      }
      if (pendingR) {
        pendingR = false;
        if (key === "a") {
          console.log(import_picocolors17.default.magenta("\n  Restarting API...\n"));
          await killProcess(apiProc);
          apiProc = startApi();
          printControls();
        } else if (key === "w") {
          console.log(import_picocolors17.default.cyan("\n  Restarting Web...\n"));
          await killProcess(webProc);
          webProc = startWeb();
          printControls();
        } else if (key === "c") {
          console.log(import_picocolors17.default.yellow("\n  Restarting Collab...\n"));
          await killProcess(collabProc);
          collabProc = startCollab();
          printControls();
        } else if (key === "b") {
          console.log(import_picocolors17.default.yellow("\n  Restarting all...\n"));
          await Promise.all([killProcess(apiProc), killProcess(webProc), killProcess(collabProc)]);
          apiProc = startApi();
          webProc = startWeb();
          collabProc = startCollab();
          printControls();
        }
      }
    });
  }
  await new Promise(() => {
  });
}

// bin/learnhouse.ts
var COMMANDS = [
  { name: "setup", desc: "Interactive setup wizard" },
  { name: "start", desc: "Start services" },
  { name: "stop", desc: "Stop services" },
  { name: "logs", desc: "Stream logs" },
  { name: "config", desc: "Show configuration" },
  { name: "backup", desc: "Backup & restore database" },
  { name: "deployments", desc: "Manage deployments & resources" },
  { name: "doctor", desc: "Diagnose issues" },
  { name: "shell", desc: "Container shell access" },
  { name: "dev", desc: "Development mode" }
];
async function showWelcome() {
  await printBanner();
  console.log(import_picocolors18.default.bold(import_picocolors18.default.white("  Available commands:\n")));
  for (const cmd of COMMANDS) {
    console.log(`    ${import_picocolors18.default.cyan(cmd.name.padEnd(14))} ${import_picocolors18.default.dim(cmd.desc)}`);
  }
  console.log();
  console.log(import_picocolors18.default.dim("  Run a command with: npx learnhouse <command>"));
  console.log(import_picocolors18.default.dim("  Get started with:   npx learnhouse setup"));
  console.log();
}
var program2 = new Command();
program2.name("learnhouse").description("The official LearnHouse CLI \u2014 deploy, manage, and operate your LearnHouse instance").version(VERSION).action(showWelcome);
program2.command("setup").description("Interactive setup wizard for LearnHouse").action(setupCommand);
program2.command("start").description("Start LearnHouse services").action(startCommand);
program2.command("stop").description("Stop LearnHouse services").action(stopCommand);
program2.command("logs").description("Stream logs from LearnHouse services").action(logsCommand);
program2.command("config").description("Show current LearnHouse configuration").action(configCommand);
program2.command("backup").description("Backup & restore LearnHouse database").argument("[archive]", "Path to backup archive for restore").option("--restore", "Restore from a backup archive").action(backupCommand);
program2.command("deployments").description("Manage deployments & resource limits").action(deploymentsCommand);
program2.command("doctor").description("Diagnose common issues with LearnHouse").action(doctorCommand);
program2.command("shell").description("Open a shell in a LearnHouse container").action(shellCommand);
program2.command("dev").description("Start development environment (DB + Redis in Docker, API + Web locally)").option("--ee", "Enable Enterprise Edition features (keeps ee/ folder)").action(devCommand);
var updateCheck = checkForUpdates();
program2.parseAsync().then(() => updateCheck.catch(() => {
}));
