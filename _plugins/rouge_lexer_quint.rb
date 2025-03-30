require 'rouge'

module Rouge
  module Lexers
    class Quint < RegexLexer
      title "Quint"
      desc "Quint specification language"
      tag 'quint'
      filenames '*.qnt'

      def self.keywords
        @keywords ||= Set.new %w(
          module val var def action temporal pure nondet
          if else true false not and or
        )
      end

      def self.types
        @types ||= Set.new %w(
          int bool str Set List Rec Tup
        )
      end

      state :root do
        rule %r{//.*$}, Comment::Single
        rule %r/[-+]?[0-9]+/, Num::Integer
        rule %r/"/, Str, :string
        rule %r/[(),{}]/, Punctuation
        rule %r/[a-zA-Z_][a-zA-Z0-9_]*/ do |m|
          if self.class.keywords.include? m[0]
            token Keyword
          elsif self.class.types.include? m[0]
            token Keyword::Type
          else
            token Name
          end
        end
        rule %r/[:=]/, Operator
        rule %r/'/, Name::Decorator  # or another fitting class
        rule %r/_\d+/, Name::Variable
        rule %r/\./, Operator
        rule %r/[,;]/, Punctuation
        rule %r/\s+/, Text
      end

      state :string do
        rule %r/"/, Str, :pop!
        rule %r/[^"]+/, Str
      end
    end
  end
end