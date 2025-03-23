---
---

const categories = {
{% for category in site.categories %}
{% assign category_name = category[0] %}
{{ category_name | jsonify }}: [
  {% for post in category[1] %}
{
  url: `{{ site.baseurl }}{{ post.url }}`,
      date: `{{ post.date | date_to_string }}`,
    title: `{{ post.title | escape }}` // prevent quotes breaking JS
}{% unless forloop.last %},{% endunless %}
{% endfor %}
]{% unless forloop.last %},{% endunless %}
{% endfor %}
};
console.log(categories)

window.onload = function () {
  document.querySelectorAll(".category").forEach((category) => {
    category.addEventListener("click", function (e) {
      const posts = categories[e.target.innerText.replace(" ","_")];
      let html = ``
      posts.forEach(post=>{
        html += `
        <a class="modal-article" href="${post.url}">
          <h4>${post.title}</h4>
          <small class="modal-article-date">${post.date}</small>
        </a>
        `
      })
      document.querySelector("#category-modal-title").innerText = e.target.innerText;
      document.querySelector("#category-modal-content").innerHTML = html;
      document.querySelector("#category-modal-bg").classList.toggle("open");
      document.querySelector("#category-modal").classList.toggle("open");
    });
  });

  document.querySelector("#category-modal-bg").addEventListener("click", function(){
    document.querySelector("#category-modal-title").innerText = "";
    document.querySelector("#category-modal-content").innerHTML = "";
    document.querySelector("#category-modal-bg").classList.toggle("open");
    document.querySelector("#category-modal").classList.toggle("open");
  })
};