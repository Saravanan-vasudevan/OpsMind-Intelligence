using System.Linq.Expressions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using OpsMind.Api.Auth;
using OpsMind.Api.Contracts;
using OpsMind.Api.Data;
using OpsMind.Api.Domain;
using OpsMind.Api.Services;

namespace OpsMind.Api.Controllers;

[Route("api/equipment-categories")]
public class EquipmentCategoriesController : ApiControllerBase
{
    private static readonly Expression<Func<EquipmentCategory, CategoryDto>> ToDto = c => new CategoryDto(
        c.Id, c.Name, c.Equipment.Count);

    private readonly OpsMindDbContext _db;
    private readonly ICurrentUser _current;
    private readonly AuditService _audit;

    public EquipmentCategoriesController(OpsMindDbContext db, ICurrentUser current, AuditService audit)
    {
        _db = db;
        _current = current;
        _audit = audit;
    }

    [HttpGet]
    public async Task<ActionResult<List<CategoryDto>>> List(CancellationToken ct) =>
        await _db.EquipmentCategories.AsNoTracking().OrderBy(c => c.Name).Select(ToDto).ToListAsync(ct);

    [HttpPost]
    [Authorize(Policy = Policies.AdminOnly)]
    public async Task<ActionResult<CategoryDto>> Create(CategoryRequest request, CancellationToken ct)
    {
        var name = request.Name.Trim();
        if (await _db.EquipmentCategories.AnyAsync(c => c.Name == name, ct))
            return ConflictProblem($"A category named '{name}' already exists.");

        var category = new EquipmentCategory { Id = Guid.NewGuid(), OrganisationId = _current.OrganisationId!.Value, Name = name };
        _db.EquipmentCategories.Add(category);
        _audit.Add("category.create", nameof(EquipmentCategory), category.Id, new { category.Name });
        await _db.SaveChangesAsync(ct);

        return StatusCode(StatusCodes.Status201Created, new CategoryDto(category.Id, category.Name, 0));
    }

    [HttpPut("{id:guid}")]
    [Authorize(Policy = Policies.AdminOnly)]
    public async Task<ActionResult<CategoryDto>> Update(Guid id, CategoryRequest request, CancellationToken ct)
    {
        var category = await _db.EquipmentCategories.FirstOrDefaultAsync(c => c.Id == id, ct);
        if (category is null) return NotFound();

        var name = request.Name.Trim();
        if (await _db.EquipmentCategories.AnyAsync(c => c.Id != id && c.Name == name, ct))
            return ConflictProblem($"A category named '{name}' already exists.");

        category.Name = name;
        _audit.Add("category.update", nameof(EquipmentCategory), category.Id, new { category.Name });
        await _db.SaveChangesAsync(ct);

        return await _db.EquipmentCategories.AsNoTracking().Where(c => c.Id == id).Select(ToDto).FirstAsync(ct);
    }

    [HttpDelete("{id:guid}")]
    [Authorize(Policy = Policies.AdminOnly)]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        var category = await _db.EquipmentCategories.FirstOrDefaultAsync(c => c.Id == id, ct);
        if (category is null) return NotFound();

        if (await _db.EquipmentItems.AnyAsync(e => e.CategoryId == id, ct))
            return ConflictProblem("This category is used by equipment and cannot be deleted.");

        _db.EquipmentCategories.Remove(category);
        _audit.Add("category.delete", nameof(EquipmentCategory), category.Id, new { category.Name });
        await _db.SaveChangesAsync(ct);
        return NoContent();
    }
}
