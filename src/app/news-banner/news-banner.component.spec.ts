import { ComponentFixture, TestBed } from '@angular/core/testing';

import { NewsBannerComponent } from './news-banner.component';

describe('NewsBannerComponent', () => {
  let component: NewsBannerComponent;
  let fixture: ComponentFixture<NewsBannerComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NewsBannerComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(NewsBannerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should toggle login modal', () => {
    expect(component.showLoginModal).toBeFalsy();
    component.toggleLoginModal();
    expect(component.showLoginModal).toBeTruthy();
    component.toggleLoginModal();
    expect(component.showLoginModal).toBeFalsy();
  });

  it('should login user when credentials are provided', () => {
    component.username = 'testuser';
    component.password = 'testpass';
    component.login();
    expect(component.isLoggedIn).toBeTruthy();
    expect(component.currentUser).toBe('testuser');
    expect(component.showLoginModal).toBeFalsy();
  });

  it('should logout user', () => {
    component.isLoggedIn = true;
    component.currentUser = 'testuser';
    component.logout();
    expect(component.isLoggedIn).toBeFalsy();
    expect(component.currentUser).toBe('');
  });
});
