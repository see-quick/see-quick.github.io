# frozen_string_literal: true

require 'rouge'

module Jekyll
  # Custom Liquid block tag for `{% quint %}` to highlight Quint code
  class QuintBlock < Liquid::Block
    def render(context)
      code = super.strip

      # Use the custom lexer and legacy HTML formatter for Rouge
      formatter = Rouge::Formatters::HTMLLegacy.new
      lexer = Rouge::Lexers::Quint.new

      # Highlight the code with Rouge
      highlighted = formatter.format(lexer.lex(code))

      # Wrap the result in a styled container for language-quint
      <<~HTML
        <div class="language-quint highlighter-rouge">
          <div class="highlight">
            <pre class="highlight"><code class="language-quint">#{highlighted}</code></pre>
          </div>
        </div>
      HTML
    end
  end
end

# Register the block tag with Liquid so you can write '```quint'  and  '```'` in markdown
Liquid::Template.register_tag('quint', Jekyll::QuintBlock)