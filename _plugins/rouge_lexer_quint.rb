# frozen_string_literal: true

require 'rouge'

module Rouge
  module Lexers
    # A custom Rouge lexer for the Quint specification language
    # See: https://github.com/informalsystems/quint
    class Quint < RegexLexer
      title "Quint"
      desc "Quint specification language"
      tag 'quint'
      filenames '*.qnt'

      # Define all Quint keywords like `val`, `action`, etc.
      def self.keywords
        @keywords ||= Set.new %w(
          module val var def action temporal pure nondet
          if else true false not and or
        )
      end

      # Define primitive and composite types
      def self.types
        @types ||= Set.new %w(
          int bool str Set List Rec Tup
        )
      end

      # Main lexer state
      state :root do
        rule %r{//.*$}, Comment::Single                     # Single-line comment
        rule %r/[-+]?[0-9]+/, Num::Integer                  # Numbers like -1, 0, 42
        rule %r/"/, Str, :string                           # Begin string literal
        rule %r/[(),{}]/, Punctuation                      # Brackets and braces
        rule %r/[a-zA-Z_][a-zA-Z0-9_]*/ do |m|             # Identifiers
          if self.class.keywords.include? m[0]
            token Keyword
          elsif self.class.types.include? m[0]
            token Keyword::Type
          else
            token Name
          end
        end
        rule %r/[:=]/, Operator                             # Assignment and typing
        rule %r/'/, Name::Decorator                        # Prime (') notation
        rule %r/_\d+/, Name::Variable                      # Tuple access like _1, _2
        rule %r/\./, Operator                              # Dot operator (e.g., heldBy._1)
        rule %r/[,;]/, Punctuation                         # Separators
        rule %r/\s+/, Text                                 # Whitespace
      end

      # String literals (e.g., "some text")
      state :string do
        rule %r/"/, Str, :pop!
        rule %r/[^"]+/, Str
      end
    end
  end
end