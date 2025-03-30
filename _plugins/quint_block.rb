require 'rouge'

module Jekyll
  class QuintBlock < Liquid::Block
    def render(context)
      code = super.strip

      formatter = Rouge::Formatters::HTMLLegacy.new
      lexer = Rouge::Lexers::Quint.new
      highlighted = formatter.format(lexer.lex(code))

      <<~HTML
      <div class="highlight language-quint">
        <div class="highlight">
          <pre><code class="language-quint">#{highlighted}</code></pre>
        </div>
      </div>
      HTML
    end
  end
end

Liquid::Template.register_tag('quint', Jekyll::QuintBlock)