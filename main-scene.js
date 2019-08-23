import {tiny, defs} from './assignment-4-resources.js';
                                                                // Pull these names into this module's scope for convenience:
const { Vec, Mat, Mat4, Color, Light, Shape, Shader, Material, Texture,
         Scene, Canvas_Widget, Code_Widget, Text_Widget } = tiny;
const { Cube, Subdivision_Sphere, Transforms_Sandbox_Base,  Capped_Cylinder, Tetrahedron, Torus, Square, Triangle  } = defs;

    // Now we have loaded everything in the files tiny-graphics.js, tiny-graphics-widgets.js, and assignment-4-resources.js.
    // This yielded "tiny", an object wrapping the stuff in the first two files, and "defs" for wrapping all the rest.

// (Can define Main_Scene's class here)

export class Body
{                                   // **Body** can store and update the properties of a 3D body that incrementally
                                    // moves from its previous place due to velocities.  It conforms to the
                                    // approach outlined in the "Fix Your Timestep!" blog post by Glenn Fiedler.
  constructor( shape, material, size )
    { Object.assign( this, 
             { shape, material, size } )
    }
  emplace( location_matrix, linear_velocity, angular_velocity, spin_axis = Vec.of(0,0,0).randomized(1).normalized() )
    {                               // emplace(): assign the body's initial values, or overwrite them.
      this.center   = location_matrix.times( Vec.of( 0,0,0,1 ) ).to3();
      this.rotation = Mat4.translation( this.center.times( -1 ) ).times( location_matrix );
      this.previous = { center: this.center.copy(), rotation: this.rotation.copy() };
                                              // drawn_location gets replaced with an interpolated quantity:
      this.drawn_location = location_matrix;                                    
      return Object.assign( this, { linear_velocity, angular_velocity, spin_axis } )
    }
  advance( time_amount ) 
    {                           // advance(): Perform an integration (the simplistic Forward Euler method) to
                                // advance all the linear and angular velocities one time-step forward.
      this.previous = { center: this.center.copy(), rotation: this.rotation.copy() };
                                                 // Apply the velocities scaled proportionally to real time (time_amount):
                                                 // Linear velocity first, then angular:
      this.center = this.center.plus( this.linear_velocity.times( time_amount ) );
      this.rotation.pre_multiply( Mat4.rotation( time_amount * this.angular_velocity, this.spin_axis ) );
    }
  blend_rotation( alpha )         
    {                        // blend_rotation(): Just naively do a linear blend of the rotations, which looks
                             // ok sometimes but otherwise produces shear matrices, a wrong result.

                                  
       return this.rotation.map( (x,i) => Vec.from( this.previous.rotation[i] ).mix( x, alpha ) );
    }
  blend_state( alpha )            
    {                             // blend_state(): Compute the final matrix we'll draw using the previous two physical
                                  // locations the object occupied.  We'll interpolate between these two states as 
                                  // described at the end of the "Fix Your Timestep!" blog post.
      this.drawn_location = Mat4.translation( this.previous.center.mix( this.center, alpha ) )
                                      .times( this.blend_rotation( alpha ) )
                                      .times( Mat4.scale( this.size ) );
    }
                                              // The following are our various functions for testing a single point,
                                              // p, against some analytically-known geometric volume formula 
                                              // (within some margin of distance).
  static intersect_cube( p, margin = 0 )
    { return p.every( value => value >= -1 - margin && value <=  1 + margin )
    }
  static intersect_sphere( p, margin = 0 )
    { return p.dot( p ) < 1 + margin;
    }
  check_if_colliding( b, collider )   
    {                                     // check_if_colliding(): Collision detection function.
                                          // DISCLAIMER:  The collision method shown below is not used by anyone; it's just very quick 
                                          // to code.  Making every collision body an ellipsoid is kind of a hack, and looping 
                                          // through a list of discrete sphere points to see if the ellipsoids intersect is *really* a 
                                          // hack (there are perfectly good analytic expressions that can test if two ellipsoids 
                                          // intersect without discretizing them into points).
      if ( this == b ) 
        return false;                     // Nothing collides with itself.
                                          // Convert sphere b to the frame where a is a unit sphere:
      var T = this.inverse.times( b.drawn_location );

      const { intersect_test, points, leeway } = collider;
                                          // For each vertex in that b, shift to the coordinate frame of
                                          // a_inv*b.  Check if in that coordinate frame it penetrates 
                                          // the unit sphere at the origin.  Leave some leeway.
      return points.arrays.position.some( p => intersect_test( T.times( p.to4(1) ).to3(), leeway ) );
    }
}

const Main_Scene =
class City_Runner extends Scene
{                                             // **Solar_System**:  Your Assingment's Scene.
  constructor()
    {                  // constructor(): Scenes begin by populating initial values like the Shapes and Materials they'll need.
      super();
                                                        // At the beginning of our program, load one of each of these shape 
                                                        // definitions onto the GPU.  NOTE:  Only do this ONCE per shape.
                                                        // Don't define blueprints for shapes in display() every frame.

                                               
      this.shapes = { 'box' : new Cube(),
                   'ground' : new Cube(),
                   'ball_4' : new Subdivision_Sphere( 4 ),
                     'star' : new Planar_Star(),
                 'cylinder' : new Capped_Cylinder(100,100, [0,10]),
                 'torus': new Torus(100,100,[0,10]),
                    'square': new Square(),
                  'triangle': new Triangle(),
                  'tetrahedron': new Tetrahedron(false) };
      this.shapes.ground.arrays.texture_coord.forEach( coord => coord.scale(50));

      this.sounds = { 'blast' : new Audio('assets/blast.wav'),
                      'drift' : new Audio('assets/carDrifting.wav'),
                 'accelerate' : new Audio('assets/m3_accelerate.wav')};


      this.bodies = [];
      this.roads = [];
      this.obstacles = [];
      this.collider = { intersect_test: Body.intersect_cube, points: new defs.Subdivision_Sphere(4), leeway: .05 };
      this.off_road_collider = { intersect_test: Body.intersect_cube, points: new defs.Subdivision_Sphere(3), leeway: .4 };

                                                      
      
                                                              // *** Shaders ***

                                                              // NOTE: The 2 in each shader argument refers to the max
                                                              // number of lights, which must be known at compile time.
                                                              
                                                              // A simple Phong_Blinn shader without textures:
      const phong_shader      = new defs.Phong_Shader  (2);
                                                              // Adding textures to the previous shader:
      const texture_shader    = new defs.Textured_Phong(2);
                                                              // Same thing, but with a trick to make the textures 
                                                              // seemingly interact with the lights:
      const texture_shader_2  = new defs.Fake_Bump_Map (2);
                                                              // A Simple Gouraud Shader that you will implement:
      const sun_shader        = new Sun_Shader();
      const flame_shader      = new Flame_Shader();
      
                                              // *** Materials: *** wrap a dictionary of "options" for a shader.


      this.materials = { plastic: new Material( phong_shader, 
                                    { ambient: 1, diffusivity: 1, specularity: 0, color: Color.of( 1,.5,1,1 ) } ),
                              hp: new Material( phong_shader, 
                                    { ambient: 1, diffusivity: 1, specularity: 0, color: Color.of( 1,.5,1,1 ) } ),
                   plastic_stars: new Material( texture_shader_2,    
                                    { texture: new Texture( "assets/stars.png" ),
                                      ambient: 0, diffusivity: 1, specularity: 0, color: Color.of( .4,.4,.4,1 ) } ),
                           metal: new Material( phong_shader,
                                    { ambient: 0, diffusivity: 1, specularity: 1, color: Color.of( 1,.5,1,1 ) } ),
                     metal_earth: new Material( texture_shader_2,    
                                    { texture: new Texture( "assets/earth.gif" ),
                                      ambient: 0, diffusivity: 1, specularity: 1, color: Color.of( .4,.4,.4,1 ) } ),
                        brick: new Material( texture_shader_2,    
                                    { texture: new Texture( "assets/bricks.png"),
                                      ambient: 0.3, diffusivity: 0, specularity: 0 , color: Color.of( 1,1,1,1 ), smoothness: 10} ),

                        leaves: new Material( texture_shader_2,    
                                    { texture: new Texture( "assets/leaves.jpg"),
                                      ambient: .5, diffusivity: 0, specularity: 0 , color: Color.of( .2,.8,.2,1 ), smoothness: 10} ),
                             sun: new Material( sun_shader, { ambient: 1, color: Color.of( 0,0,0,1 ) } ),
                               flame: new Material( flame_shader, { ambient: 1, color: Color.of( 0,0,0,1 ) } ),
                               skybox_zneg : new Material( texture_shader_2,
                                    { texture: new Texture("assets/zneg.jpeg"),
                                      ambient: 0.6, diffusivity: 0, specularity: 0, color: Color.of(.4,.4,.4,1) }),
                       skybox_zpos : new Material( texture_shader_2,
                                    { texture: new Texture("assets/zpos.jpeg"),
                                      ambient: 0.6, diffusivity: 0, specularity: 0, color: Color.of(.4,.4,.4,1) }),
                       skybox_xpos : new Material( texture_shader_2,
                                    { texture: new Texture("assets/xpos.jpeg"),
                                      ambient: 0.6, diffusivity: 0, specularity: 0, color: Color.of(.4,.4,.4,1) }),
                       skybox_xneg : new Material( texture_shader_2,
                                    { texture: new Texture("assets/xneg.jpeg"),
                                      ambient: 0.6, diffusivity: 0, specularity: 0, color: Color.of(.4,.4,.4,1) }),
                       skybox_ypos : new Material( texture_shader_2,
                                    { texture: new Texture("assets/ypos.jpeg"),
                                      ambient: 0.6, diffusivity: 0, specularity: 0, color: Color.of(.4,.4,.4,1) }),
                       skybox_yneg : new Material( texture_shader_2,
                                    { texture: new Texture("assets/yneg.jpeg"),
                                      ambient: 0.6, diffusivity: 0, specularity: 0, color: Color.of(.4,.4,.4,1) }),
                       text_box : new Material( texture_shader_2,
                                    { texture: new Texture("assets/textBox.jpeg"),
                                      ambient: 0.6, diffusivity: 1, specularity: 0.5, color: Color.of(.4,.4,.4,1) }),
                        stop_sign: new Material( texture_shader_2,
                                    { texture: new Texture("assets/stop.jpg"),
                                      ambient: 0.6, diffusivity: 0.5, specularity: 1, color: Color.of(.4, .4, .4,1)}),
                       };

                                  // Some setup code that tracks whether the "lights are on" (the stars), and also
                                  // stores 30 random location matrices for drawing stars behind the solar system:
      this.lights_on = false;
      this.star_matrices = [];
      for( let i=0; i<30; i++ )
        this.star_matrices.push( Mat4.rotation( Math.PI/2 * (Math.random()-.5), Vec.of( 0,1,0 ) )
                         .times( Mat4.rotation( Math.PI/2 * (Math.random()-.5), Vec.of( 1,0,0 ) ) )
                         .times( Mat4.translation([ 0,0,-150 ]) ) );

      this.thrust = Vec.of( 0,0,0 );
      this.model_transform = Mat4.identity();

      this.bodies.push(new Body(this.shapes.box, this.materials.plastic.override( Color.of(1,1,1,1)), Vec.of(1,1,1)).emplace(Mat4.identity().times(Mat4.translation([0,0.295,0])).times(Mat4.scale([.25*0.5,0.08*0.5,.6*0.5]))));

      this.obstacles.push(new Body(this.shapes.box, this.materials.plastic, Vec.of(1,1,1))
                 .emplace(Mat4.identity().times(Mat4.translation([0,0,-10])).times(Mat4.scale([.5,1,.5])),0,0));

      this.count = 0;
      //kinetics
      this.acceleration=0;
      this.lasttime=0;
      this.velocity=0;
      this.hp = 1;
      this.hp_color = Color.of( .13,.55,0.13,1 );
      this.blast = Mat4.identity();

      //game logistics
      this.game_start=0;
      this.collide=0;
      this.first_frame = 1;
      
      //camera
      this.perspective = 0;
      this.overlook = 0;
      this.off_road = 1;
      

    }
  make_control_panel()
    {                                 // make_control_panel(): Sets up a panel of interactive HTML elements, including
                                      // buttons with key bindings for affecting this scene, and live info readouts.

      this.key_triggered_button( "Reverse",     [ "ArrowDown" ], () => this.acceleration = -0.03, undefined, () => this.acceleration = 0.01 );
      this.key_triggered_button( "Accelerate",[ "ArrowUp" ], () => this.acceleration = 0.05, undefined, () => this.acceleration = -0.01 );
      this.new_line();
      this.key_triggered_button( "Move Left",   [ "a" ], () => this.thrust[0] =  -10, undefined, () => this.thrust[0] = 0 );
      this.key_triggered_button( "Move Right",  [ "d" ], () => this.thrust[0] = 10, undefined, () => this.thrust[0] = 0 );
      
      this.key_triggered_button( "Turn Right",  [ "ArrowRight" ], () => this.bodies[0].drawn_location.post_multiply(Mat4.scale([2,2,1])).post_multiply(Mat4.rotation(-0.1,Vec.of(0,1,0))).post_multiply(Mat4.scale([0.5,0.5,1])), undefined, () => this.model_transform = this.model_transform );
      this.key_triggered_button( "Turn Left",  [ "ArrowLeft" ], () => this.bodies[0].drawn_location.post_multiply(Mat4.scale([2,2,1])).post_multiply(Mat4.rotation(0.1,Vec.of(0,1,0))).post_multiply(Mat4.scale([0.5,0.5,1])), undefined, () => this.model_transform = this.model_transform );
      this.key_triggered_button( "Start",  [ "s" ], () => this.game_start = 1);

      this.key_triggered_button( "TPP/FPP",  [ "p" ], () => this.perspective = !this.perspective);
      this.key_triggered_button( "Overlook",  [ "o" ], () => this.overlook = !this.overlook);
    }
  display( context, program_state )
    {    
      let _this=this;
      function play_sound( name, volume = 1 )
      { 
        if( 0 < _this.sounds[ name ].currentTime && _this.sounds[ name ].currentTime < .3 ) return;
        _this.sounds[ name ].currentTime = 0;
        _this.sounds[ name ].volume = Math.min(Math.max(volume, 0), 1);
        _this.sounds[ name ].play();
      }

      if( this.acceleration == 0.05 ) { play_sound("accelerate"); }
      if( this.acceleration == -.03 ) { play_sound("drift"); }

      if( !context.scratchpad.controls ) 
        {     
          context.scratchpad.controls = true;       
          program_state.set_camera( Mat4.look_at( Vec.of( 0,90,40 ), Vec.of( 0,90,0 ), Vec.of( 0,1,0 ) ) );
          this.initial_camera_location = program_state.camera_inverse;
          program_state.projection_transform = Mat4.perspective( Math.PI/4, context.width/context.height, 1, 800 );
        }

      const blue = Color.of( 0,0.75,1,1 ), limegreen = Color.of( .2,.8,.2,1 ), grey = Color.of(.7, .7, .7, 1), black = Color.of(0,0,0,1), ground =  Color.of(.3, .3, .3, 1), road = Color.of(.2, .2, .2, 1), 
            gold = Color.of( 1, 0.84, 0, 1), green = Color.of( .13,.55,0.13,1 ), white = Color.of(1, 0.937255, 0.835294, 1), pink = Color.of(1, .4, .7, 1), red = Color.of(.9, .1, .23, 1),
            orange = Color.of( 1, 0.5, 0, 1), brown = Color.of( .65,.16,0.16,1 );
      const wheat = Color.of(1,1,1, 1), papayawhip = Color.of(.9, .1, .23, 1), cyan = Color.of(0,1,1,1);
      const darkgray = Color.of(0.662745, 0.662745, 0.662745, 1);

                                                                      // Find how much time has passed in seconds; we can use
                                                                      // time as an input when calculating new transforms:
      const t = program_state.animation_time / 1000;
      this.time=program_state.animation_time;
      program_state.lights = [ new Light( Vec.of( 0,0,0,1 ), Color.of( 1,1,1,1 ), 100000 ) ];
      //velocity calculation
      if(this.time-this.lasttime==this.time){  //first scene
          this.velocity=0;
      }
      else{
          this.velocity+=this.acceleration*(this.time-this.lasttime);
      }
      if(this.acceleration == -0.01)
        this.velocity = Math.max(this.velocity,0);
      else if(this.acceleration == 0.01)
        this.velocity = Math.min(this.velocity,0);
   //collision with obstacles
    for(let a of this.obstacles){
         a.inverse = Mat4.inverse( a.drawn_location );
        for( let b of this.bodies )                                      
        {                               // Pass the two bodies and the collision shape to check_if_colliding():
          if( !a.check_if_colliding( b, this.collider ) ){
            continue;
          }else{
            this.hp=Math.max(this.hp-0.03,0);
            this.velocity = Math.min(this.velocity, 0);
          }
        }
     }
      
      //off road detection
     for(let a of this.roads){
         a.inverse = Mat4.inverse( a.drawn_location );
        for( let b of this.bodies )                                      
        {                               // Pass the two bodies and the collision shape to check_if_colliding():
          if(a.check_if_colliding( b, this.off_road_collider ) ){
            this.off_road = 0;
            break;
          }
        }
        if(!this.off_road) break;
     }
    if(this.off_road)
        this.hp=Math.max(this.hp-0.02,0);
    
      //velocity cap
      if(this.velocity > 0)
        this.velocity=Math.min(this.velocity, 15);
      else
        this.velocity=Math.max(this.velocity, -10);
      

      //health bar color change
      if(this.hp<0.5&&this.hp>=0.25){
        this.hp_color= Color.of( 1, 0.498039, 0.313725,1);
      }
      else if(this.hp>0&&this.hp<0.25){
        this.hp_color= Color.of( 1,0,0,1 );
      }
      else if(this.hp==0){//game over
        if(!this.count)
        {
            this.blast = this.bodies[0].drawn_location.times(Mat4.scale([0.3/0.25,0.3/0.08,0.3/0.6]));
            if( this.count == 0) { play_sound("blast"); }
        }
        this.shapes.ball_4.draw(context, program_state, this.blast, this.materials.sun.override(orange));
        this.collide = 1;
        if(this.count!=50){
          this.count++;
          this.bodies[0].drawn_location.post_multiply(Mat4.scale([1.0305385,1.0305385,1.0305385]));
          this.blast.post_multiply(Mat4.scale([1.036485,1.036485,1.036485]));
        }
        this.velocity = 0;
        this.perspective = 0;

       }
      this.thrust[2]=-this.velocity;                        

      let intro_transform = Mat4.identity().times(Mat4.translation([0,90,0]))
                                          .times(Mat4.scale([20,20,1/5]));
      this.shapes.square.draw(context, program_state, intro_transform, this.materials.text_box)
      

      this.bodies[0].drawn_location = this.bodies[0].drawn_location.times( Mat4.translation( this.thrust.times(0.001*(this.time-this.lasttime)) ) );
      if(this.overlook){
        //bird view
          const desired_camera = Mat4.inverse( Mat4.identity().times( Mat4.translation( [ 0,120,25 ] ) ).times(Mat4.rotation(-0.5*Math.PI,Vec.of(1,0,0))) );
          const dt = program_state.animation_delta_time;
          program_state.set_camera( desired_camera.map( (x,i) => Vec.from( program_state.camera_inverse[i] ).mix( x, .003*dt ) ) );
      }else if(this.game_start){
        if(!this.perspective){
          //third person view
          const desired_camera = Mat4.inverse( this.bodies[0].drawn_location.times(Mat4.scale([1/.25,1/0.08,1/.6])).times( Mat4.translation( [ 0,5,7 ] ) ).times(Mat4.rotation(-0.3,Vec.of(1,0,0))) );
          const dt = program_state.animation_delta_time;
          program_state.set_camera( desired_camera.map( (x,i) => Vec.from( program_state.camera_inverse[i] ).mix( x, .003*dt ) ) );
          
          //draw health bar
          let hp_tranform = program_state.camera_transform.times(Mat4.translation([0,2,-7]))
                                                       .times(Mat4.scale([this.hp,0.2,0.2]));
          this.shapes.box.draw(context,program_state,hp_tranform,this.materials.plastic.override( this.hp_color ));
        }else{
          //first person view
          const desired_camera = Mat4.inverse( this.bodies[0].drawn_location.times(Mat4.scale([1/.25,1/0.08,1/.6])).times( Mat4.translation( [ 0,3,0 ] ) )) ;
          const dt = program_state.animation_delta_time;
          program_state.set_camera( desired_camera.map( (x,i) => Vec.from( program_state.camera_inverse[i] ).mix( x, .003*dt ) ) );

          //draw health bar
          let hp_tranform = program_state.camera_transform.times(Mat4.translation([0,2,-7]))
                                                       .times(Mat4.scale([this.hp,0.2,0.2]));
          this.shapes.box.draw(context,program_state,hp_tranform,this.materials.metal.override( this.hp_color ));
        }    
      }
      this.obstacles[0].shape.draw(context,program_state,this.obstacles[0].drawn_location, this.obstacles[0].material.override(blue)); 
      this.lasttime=program_state.animation_time;
      
      
      let ground_transformation = _this.model_transform.times(Mat4.scale([100,0.1,100]));
      _this.shapes.ground.draw( context, program_state, ground_transformation, _this.materials.brick );

      draw_road();
      if(!this.collide)
        draw_car(this.bodies[0]);
      draw_skybox(Mat4.identity());
      
      ////outer buildings/////
      let building_transformation_outer = _this.model_transform.times(Mat4.translation([-6,0,12]));
      let temp = building_transformation_outer.times(Mat4.identity());

      draw_building_2(building_transformation_outer, 4, 6, 4, white, gold);

      building_transformation_outer.post_multiply(Mat4.translation([1,0,-7]));
      draw_building_1( building_transformation_outer,5,6,3, blue, white);

      building_transformation_outer.post_multiply(Mat4.translation([1,0,-10]));
      draw_building_1( building_transformation_outer,3,3,8, orange, white);

      building_transformation_outer.post_multiply(Mat4.translation([-1,0,-10]));
      draw_building_2( building_transformation_outer,3,4,3, white, blue);

      building_transformation_outer.post_multiply(Mat4.translation([7,0,-8]));
      draw_building_1( building_transformation_outer,8,6,3, limegreen, white);

      building_transformation_outer.post_multiply(Mat4.translation([18,0,0]));
      draw_building_1( building_transformation_outer,12,3,3, gold, white);

      building_transformation_outer.post_multiply(Mat4.translation([14,0,-1]));
      draw_building_2( building_transformation_outer,3,6,3, white, red);

      building_transformation_outer.post_multiply(Mat4.translation([10,0,7]));
      draw_building_2( building_transformation_outer,3,6,3, white, red);

      building_transformation_outer.post_multiply(Mat4.translation([7,0,7]));
      draw_building_2( building_transformation_outer,3,6,3, white, red);

      building_transformation_outer.post_multiply(Mat4.translation([4,0,3]));
      for (var i = 0; i < 13; i++) {
          building_transformation_outer.post_multiply(Mat4.translation([0,0,6]));
          draw_tree(building_transformation_outer);
       }

       building_transformation_outer.post_multiply(Mat4.translation([2,0,3]));
      for (var i = 0; i < 13; i++) {
          building_transformation_outer.post_multiply(Mat4.translation([-6,0,0]));
          draw_pinetree(building_transformation_outer);
       }

      ///repeat for the other half////
      building_transformation_outer = temp;
      building_transformation_outer.post_multiply(Mat4.translation([-7,0,1]));
      draw_building_1( building_transformation_outer,3,6,5, blue, white);

      building_transformation_outer.post_multiply(Mat4.translation([-10,0,1]));
      draw_building_1( building_transformation_outer,8,3,3, orange, white);

      building_transformation_outer.post_multiply(Mat4.translation([-10,0,-1]));
      draw_building_2( building_transformation_outer,3,4,3, white, blue);

      building_transformation_outer.post_multiply(Mat4.translation([-8,0,7]));
      draw_building_1( building_transformation_outer,3,6,8, limegreen, white);

      building_transformation_outer.post_multiply(Mat4.translation([0,0,18]));
      draw_building_1( building_transformation_outer,3,3,12, gold, white);

      building_transformation_outer.post_multiply(Mat4.translation([-1,0,14]));
      draw_building_2( building_transformation_outer,3,6,3, white, red);

      building_transformation_outer.post_multiply(Mat4.translation([7,0,10]));
      draw_building_2( building_transformation_outer,3,6,3, white, red);

      building_transformation_outer.post_multiply(Mat4.translation([7,0,7]));
      draw_building_2( building_transformation_outer,3,6,3, white, red);

      


      ////inner buildings/////
      let building_transformation_inner = _this.model_transform.times(Mat4.translation([5,0,10]));
      draw_building_1( building_transformation_inner,4,4,9, limegreen, white);

      building_transformation_inner.post_multiply(Mat4.translation([0,0,-10]));
      draw_building_2( building_transformation_inner,2,8,2, white, orange);

      building_transformation_inner.post_multiply(Mat4.translation([4,0,-10]));
      draw_building_1( building_transformation_inner,10,8,10, red, white);

      building_transformation_inner.post_multiply(Mat4.translation([14,0,-3]));
      draw_building_1( building_transformation_inner,7,5,3, orange, white);

      building_transformation_inner.post_multiply(Mat4.translation([10,0,0]));
       draw_building_2( building_transformation_inner,3,6,3, white, red);

       building_transformation_inner.post_multiply(Mat4.translation([7,0,7]));
       draw_building_2( building_transformation_inner,3,6,3, white, red);

       building_transformation_inner.post_multiply(Mat4.translation([7,0,7]));
       draw_building_2( building_transformation_inner,3,6,3, white, red);

       building_transformation_inner.post_multiply(Mat4.translation([3,0,1]));

       for (var i = 0; i < 11; i++) {
          building_transformation_inner.post_multiply(Mat4.translation([0,0,6]));
          draw_tree(building_transformation_inner);
       }
      
         for (var i = 0; i < 10; i++) {
          building_transformation_inner.post_multiply(Mat4.translation([-6,0,0]));
          draw_pinetree(building_transformation_inner);
       }
        
       ///repeat for the other half////
       building_transformation_inner = _this.model_transform.times(Mat4.translation([-8.5,0,23.5]));
       draw_building_1( building_transformation_inner,9,4,4, limegreen, white);

       building_transformation_inner.post_multiply(Mat4.translation([-10,0,0]));
       draw_building_2( building_transformation_inner,2,8,2, white, orange);

       building_transformation_inner.post_multiply(Mat4.translation([-10,0,4]));
        draw_building_1( building_transformation_inner,10,8,10, red, white);

       building_transformation_inner.post_multiply(Mat4.translation([-3,0,14]));
       draw_building_1( building_transformation_inner,3,5,7, orange, white);

       building_transformation_inner.post_multiply(Mat4.translation([0,0,10]));
       draw_building_2( building_transformation_inner,3,6,3, white, red);

       building_transformation_inner.post_multiply(Mat4.translation([7,0,7]));
       draw_building_2( building_transformation_inner,3,6,3, white, red);

       building_transformation_inner.post_multiply(Mat4.translation([7,0,7]));
       draw_building_2( building_transformation_inner,3,6,3, white, red);

       building_transformation_inner.post_multiply(Mat4.translation([3,0,1]));

             ////tree road stop signs/////
      let stop_sign_transformation = this.model_transform.times(Mat4.rotation(Math.PI, [0,1,0])).times(Mat4.translation([-53, 0, -5]));
      draw_stopsign( stop_sign_transformation);

      stop_sign_transformation.post_multiply(Mat4.translation([1.5,0,-10]));
      draw_stopsign( stop_sign_transformation);

      stop_sign_transformation.post_multiply(Mat4.translation([-1.5,0,-10]));
      draw_stopsign( stop_sign_transformation);

      stop_sign_transformation.post_multiply(Mat4.translation([1,0,-10]));
      draw_stopsign( stop_sign_transformation);

      stop_sign_transformation.post_multiply(Mat4.translation([-1.5,0,-10]));
      draw_stopsign( stop_sign_transformation);

      stop_sign_transformation.post_multiply(Mat4.translation([.5,0,-10]));
      draw_stopsign( stop_sign_transformation);

      stop_sign_transformation.post_multiply(Mat4.translation([.5,0,-10]));
      draw_stopsign( stop_sign_transformation);

      //pine tree road stop signs
      stop_sign_transformation = this.model_transform.times(Mat4.translation([45, 0, 70])).times(Mat4.rotation(0.5*Math.PI, [0,1,0]));
      draw_stopsign( stop_sign_transformation);

      stop_sign_transformation = stop_sign_transformation.times(Mat4.translation([-1, 0, -10]));
      draw_stopsign( stop_sign_transformation);

      stop_sign_transformation = stop_sign_transformation.times(Mat4.translation([.5, 0, -10]));
      draw_stopsign( stop_sign_transformation);

       stop_sign_transformation = stop_sign_transformation.times(Mat4.translation([-1.5, 0, -10]));
      draw_stopsign( stop_sign_transformation);
     
      stop_sign_transformation = stop_sign_transformation.times(Mat4.translation([1, 0, -10]));
      draw_stopsign( stop_sign_transformation);

      stop_sign_transformation = stop_sign_transformation.times(Mat4.translation([-.5, 0, -10]));
      draw_stopsign( stop_sign_transformation);

       this.first_frame = 0;
       this.off_road = 1;


      ////car/////

     


      function draw_repeat(shape, transformation, material, cnum, rnum, ctrans, rtrans){
        for (var i = 0; i < rnum; i++){
          shape.draw(context, program_state, transformation, material);
          for(var j = 0; j < cnum-1; j++){
            transformation.pre_multiply(ctrans);
            shape.draw(context, program_state, transformation, material);
          }
          transformation.pre_multiply(rtrans);
        }
      }

     function draw_stopsign( model_transform)
      {
        let base_transform = model_transform.times(Mat4.translation([0,0.7,0])).times(Mat4.scale([.3,.3,.3]));
        let bar_transform = base_transform.times( Mat4.rotation(Math.PI/2, [1,0,0]))
                                           .times( Mat4.scale([.2,.2,5]));
       
        let m_body = new Body(_this.shapes.cylinder, _this.materials.plastic.override( darkgray), Vec.of(1,1,1)).emplace(bar_transform, 0, 0);
        if(_this.first_frame)
          _this.obstacles.push(m_body);
        m_body.shape.draw( context, program_state, m_body.drawn_location, m_body.material);
        
        let sign_transform = base_transform.times( Mat4.translation([0,3,.2]))
                                            .times( Mat4.scale([1.5,1.5,1.5]))

        _this.shapes.square.draw(context, program_state, sign_transform, _this.materials.stop_sign);


      }

      function draw_building_1(base_transformation, x,y, z, building_color, window_color){
        base_transformation = base_transformation.times(Mat4.translation([0,2/3*y+0.1,0]));

        let height = 2/3*y;
        let width = 2/3*x;
        let depth = 2/3*z;
        let yspace = (height*2 - y*0.8)/(y + 1);
        let xspace = (width*2 - x*0.8)/(x+ 1);
        let zspace = (depth*2 - z*0.8)/(z + 1);


        let body_transform = base_transformation.times(Mat4.scale([width,height,depth]));

        let m_body = new Body(_this.shapes.box, _this.materials.plastic.override( building_color), Vec.of(1,1,1)).emplace(body_transform, 0, 0);
        if(_this.first_frame)
          _this.obstacles.push(m_body);
        m_body.shape.draw( context, program_state, body_transform, m_body.material);
        

        ////windows /////
        let window_transform = base_transformation.times(Mat4.translation([-width+0.4+xspace,height-0.4-yspace,-depth-0.05])).times(Mat4.scale([0.4,0.4,0.1]));
        draw_repeat(_this.shapes.box, window_transform, _this.materials.plastic.override( window_color ), x, y, Mat4.translation([0.8+xspace,0,0]), Mat4.translation([-(0.8+xspace)*(x-1),-0.8-yspace,0]));

        window_transform = base_transformation.times(Mat4.translation([-width+0.4+xspace,height-0.4-yspace,depth+0.05])).times(Mat4.scale([0.4,0.4,0.1]));
        draw_repeat(_this.shapes.box, window_transform, _this.materials.plastic.override( window_color ), x, y, Mat4.translation([0.8+xspace,0,0]), Mat4.translation([-(0.8+xspace)*(x-1),-0.8-yspace,0]));

        window_transform = base_transformation.times(Mat4.translation([-width-0.05,height-0.4-yspace,-depth+0.4+zspace])).times(Mat4.scale([0.1,0.4,0.4]));              
        draw_repeat(_this.shapes.box, window_transform, _this.materials.plastic.override( window_color ), z, y, Mat4.translation([0,0,0.8+zspace]), Mat4.translation([0,-0.8-yspace,-(0.8+zspace)*(z-1)]));

        window_transform = base_transformation.times(Mat4.translation([width+0.05,height-0.4-yspace,-depth+0.4+zspace])).times(Mat4.scale([0.1,0.4,0.4]));              
        draw_repeat(_this.shapes.box, window_transform, _this.materials.plastic.override( window_color ), z, y, Mat4.translation([0,0,0.8+zspace]), Mat4.translation([0,-0.8-yspace,-(0.8+zspace)*(z-1)]));

      }

       function draw_building_2(base_transformation, x, y, z, building_color, window_color){
        let height = 4/3*y;
        let yspace = (height - y*0.8)/(y + 1);
        
        base_transformation = base_transformation.times(Mat4.translation([0,0.5*height,0])).times(Mat4.rotation(0.5*Math.PI, [1,0,0]));

        let body_transform = base_transformation.times(Mat4.scale([x,z,height])); 
        let m_body = new Body(_this.shapes.cylinder, _this.materials.plastic.override( building_color), Vec.of(1,1,1)).emplace(body_transform, 0, 0);
        if(_this.first_frame)
          _this.obstacles.push(m_body);
        m_body.shape.draw( context, program_state, body_transform, m_body.material);

        let window_transform = base_transformation.times(Mat4.translation([0,0,-0.5*height+0.4+yspace])).times(Mat4.scale([x+.1,z+.1,0.8]));
        draw_repeat(_this.shapes.cylinder, window_transform, _this.materials.plastic.override( window_color ), 1, y, Mat4.identity, Mat4.translation([0,-0.8-yspace,0]));

          

      }

      function draw_road(){
        let road_base = _this.model_transform.times(Mat4.scale([5,1,5]));

        let road_transformation = road_base.times(Mat4.translation([0, 0, 0])).times(Mat4.scale([0.3,0.2,4.0]));
       
        let m_body = new Body(_this.shapes.box, _this.materials.plastic.override( road), Vec.of(1,1,1)).emplace(road_transformation, 0, 0);
        if(_this.first_frame) _this.roads.push(m_body);
        m_body.shape.draw( context, program_state, m_body.drawn_location, m_body.material);

        road_transformation = road_base.times(Mat4.translation([4, 0, -3.7])).times(Mat4.scale([4,0.2,0.3]));
        m_body = new Body(_this.shapes.box, _this.materials.plastic.override( road), Vec.of(1,1,1)).emplace(road_transformation, 0, 0);
        if(_this.first_frame) _this.roads.push(m_body);
        m_body.shape.draw( context, program_state, m_body.drawn_location, m_body.material);

        road_transformation = road_base.times(Mat4.translation([7.7, 0, -3])).times(Mat4.scale([0.3,0.2,1]));
        m_body = new Body(_this.shapes.box, _this.materials.plastic.override( road), Vec.of(1,1,1)).emplace(road_transformation, 0, 0);
        if(_this.first_frame) _this.roads.push(m_body);
        m_body.shape.draw( context, program_state, m_body.drawn_location, m_body.material);

        road_transformation = road_base.times(Mat4.translation([8.4, 0, -2.3])).times(Mat4.scale([1,0.2,0.3]));
        m_body = new Body(_this.shapes.box, _this.materials.plastic.override( road), Vec.of(1,1,1)).emplace(road_transformation, 0, 0);
        if(_this.first_frame) _this.roads.push(m_body);
        m_body.shape.draw( context, program_state, m_body.drawn_location, m_body.material);

        road_transformation = road_base.times(Mat4.translation([9.1, 0, -1.6])).times(Mat4.scale([0.3,0.2,1]));
        m_body = new Body(_this.shapes.box, _this.materials.plastic.override( road), Vec.of(1,1,1)).emplace(road_transformation, 0, 0);
        if(_this.first_frame) _this.roads.push(m_body);
        m_body.shape.draw( context, program_state, m_body.drawn_location, m_body.material);

        road_transformation = road_base.times(Mat4.translation([9.8, 0, -.9])).times(Mat4.scale([1,0.2,0.3]));
         m_body = new Body(_this.shapes.box, _this.materials.plastic.override( road), Vec.of(1,1,1)).emplace(road_transformation, 0, 0);
        if(_this.first_frame) _this.roads.push(m_body);
        m_body.shape.draw( context, program_state, m_body.drawn_location, m_body.material);

        road_transformation = road_base.times(Mat4.translation([10.5, 0, 6.6])).times(Mat4.scale([0.3,0.2,7.8]));
        m_body = new Body(_this.shapes.box, _this.materials.plastic.override( road), Vec.of(1,1,1)).emplace(road_transformation, 0, 0);
        if(_this.first_frame) _this.roads.push(m_body);
        m_body.shape.draw( context, program_state, m_body.drawn_location, m_body.material);

        road_base = road_base.times(Mat4.rotation(Math.PI, [1,0,1])).times(Mat4.translation([3.7, 0, -3.7]));
        road_transformation = road_base.times(Mat4.translation([0, 0, 0])).times(Mat4.scale([0.3,0.2,4.0]));
         m_body = new Body(_this.shapes.box, _this.materials.plastic.override( road), Vec.of(1,1,1)).emplace(road_transformation, 0, 0);
        if(_this.first_frame) _this.roads.push(m_body);
        m_body.shape.draw( context, program_state, m_body.drawn_location, m_body.material);

        road_transformation = road_base.times(Mat4.translation([4, 0, -3.7])).times(Mat4.scale([4,0.2,0.3]));
         m_body = new Body(_this.shapes.box, _this.materials.plastic.override( road), Vec.of(1,1,1)).emplace(road_transformation, 0, 0);
        if(_this.first_frame) _this.roads.push(m_body);
        m_body.shape.draw( context, program_state, m_body.drawn_location, m_body.material);

        road_transformation = road_base.times(Mat4.translation([7.7, 0, -3])).times(Mat4.scale([0.3,0.2,1]));
         m_body = new Body(_this.shapes.box, _this.materials.plastic.override( road), Vec.of(1,1,1)).emplace(road_transformation, 0, 0);
        if(_this.first_frame) _this.roads.push(m_body);
        m_body.shape.draw( context, program_state, m_body.drawn_location, m_body.material);

        road_transformation = road_base.times(Mat4.translation([8.4, 0, -2.3])).times(Mat4.scale([1,0.2,0.3]));
         m_body = new Body(_this.shapes.box, _this.materials.plastic.override( road), Vec.of(1,1,1)).emplace(road_transformation, 0, 0);
        if(_this.first_frame) _this.roads.push(m_body);
        m_body.shape.draw( context, program_state, m_body.drawn_location, m_body.material);

        road_transformation = road_base.times(Mat4.translation([9.1, 0, -1.6])).times(Mat4.scale([0.3,0.2,1]));
        m_body = new Body(_this.shapes.box, _this.materials.plastic.override( road), Vec.of(1,1,1)).emplace(road_transformation, 0, 0);
        if(_this.first_frame) _this.roads.push(m_body);
        m_body.shape.draw( context, program_state, m_body.drawn_location, m_body.material);

        road_transformation = road_base.times(Mat4.translation([9.8, 0, -.9])).times(Mat4.scale([1,0.2,0.3]));
         m_body = new Body(_this.shapes.box, _this.materials.plastic.override( road), Vec.of(1,1,1)).emplace(road_transformation, 0, 0);
        if(_this.first_frame) _this.roads.push(m_body);
        m_body.shape.draw( context, program_state, m_body.drawn_location, m_body.material);
        
         road_transformation = road_base.times(Mat4.translation([10.5, 0, 6.6])).times(Mat4.scale([0.3,0.2,7.8]));
         m_body = new Body(_this.shapes.box, _this.materials.plastic.override( road), Vec.of(1,1,1)).emplace(road_transformation, 0, 0);
        if(_this.first_frame) _this.roads.push(m_body);
        m_body.shape.draw( context, program_state, m_body.drawn_location, m_body.material);
      }


        function draw_car(car_body){
          car_body.shape.draw( context, program_state, car_body.drawn_location, car_body.material);

          let base_transform = car_body.drawn_location.times(Mat4.scale([1/2.5,1/0.8,1/6*0.75])).times(Mat4.rotation(Math.PI, [0,1,0]));
          
          if (!_this.collide) {
            let wheel1_transform = base_transform.times( Mat4.translation([2.5,-1,-6]))
                                                 .times( Mat4.rotation(Math.PI/2, [0,1,0]))
                                                 .times( Mat4.scale(Vec.of(1,1,2)));

            let wheel2_transform = base_transform.times( Mat4.translation([-2.5,-1,-6]))
                                                 .times( Mat4.rotation(Math.PI/2, [0,1,0]))
                                                 .times( Mat4.scale(Vec.of(1,1,2)));

            let wheel3_transform = base_transform.times( Mat4.translation([2.5,-1,6]))
                                                 .times( Mat4.rotation(Math.PI/2, [0,1,0]))
                                                 .times( Mat4.scale(Vec.of(1,1,2)));  

            let wheel4_transform = base_transform.times( Mat4.translation([-2.5,-1,6]))
                                                 .times( Mat4.rotation(Math.PI/2, [0,1,0]))
                                                 .times( Mat4.scale(Vec.of(1,1,2)));                                                                

            _this.shapes.torus.draw(context, program_state, wheel1_transform, _this.materials.plastic.override( darkgray ));
            _this.shapes.torus.draw(context, program_state, wheel2_transform, _this.materials.plastic.override( darkgray ));
            _this.shapes.torus.draw(context, program_state, wheel3_transform, _this.materials.plastic.override( darkgray ));
            _this.shapes.torus.draw(context, program_state, wheel4_transform, _this.materials.plastic.override( darkgray ));

            let light1_transform = base_transform.times( Mat4.translation([1.8,1.3,7]))
                                                 .times( Mat4.scale(Vec.of(0.5,0.5,0.5)));
            _this.shapes.square.draw(context, program_state, light1_transform, _this.materials.plastic.override( gold ));
            let side1_transform = light1_transform.times( Mat4.scale(Vec.of(2,2,2)))
                                                  .times( Mat4.rotation(Math.PI/2, [0,1,0]))
                                                  .times( Mat4.translation([0,-0.5,-0.5]));
            _this.shapes.triangle.draw(context, program_state, side1_transform, _this.materials.plastic.override( darkgray));
            _this.shapes.triangle.draw(context, program_state, side1_transform.times( Mat4.translation([0,0,1])), _this.materials.plastic.override(darkgray));
            let top1_transform = side1_transform.times( Mat4.scale(Vec.of(2,2,2)))
                                                .times( Mat4.translation([.18,.33,.25]))
                                                .times( Mat4.rotation(Math.PI/4, [0,0,-1]))
                                                .times( Mat4.scale(Vec.of(0.4,0.05,0.25)));
            _this.shapes.box.draw(context, program_state, top1_transform, _this.materials.plastic.override( darkgray));

            let light2_transform = base_transform.times( Mat4.translation([-1.8,1.3,7]))
                                                 .times( Mat4.scale(Vec.of(0.5,.5,.5)))
            _this.shapes.square.draw(context, program_state, light2_transform, _this.materials.plastic.override( gold ));

            let side2_transform = light2_transform.times( Mat4.scale(Vec.of(2,2,2)))
                                                  .times( Mat4.rotation(Math.PI/2, [0,1,0]))
                                                  .times( Mat4.translation([0,-0.5,-0.5]));
            _this.shapes.triangle.draw(context, program_state, side2_transform, _this.materials.plastic.override( darkgray));
            _this.shapes.triangle.draw(context, program_state, side2_transform.times( Mat4.translation([0,0,1])), _this.materials.plastic.override(darkgray));

            let top2_transform = side2_transform.times( Mat4.scale(Vec.of(2,2,2)))
                                                .times( Mat4.translation([.18,.33,.25]))
                                                .times( Mat4.rotation(Math.PI/4, [0,0,-1]))
                                                .times( Mat4.scale(Vec.of(0.4,0.05,0.25)));
            _this.shapes.box.draw(context, program_state, top2_transform, _this.materials.plastic.override( darkgray));

            let window_transform = base_transform.times( Mat4.translation([2.5,.8,0]))
                                                 .times( Mat4.scale([2.5,2.5,2.5]))
                                                 .times( Mat4.rotation(Math.PI/2, [0,-1,0]));
            _this.shapes.triangle.draw(context, program_state, window_transform, _this.materials.plastic.override( cyan ));
            _this.shapes.triangle.draw(context, program_state, window_transform.times( Mat4.translation([0,0,2])), _this.materials.plastic.override( cyan ));

            let window_transform2 = window_transform.times( Mat4.scale([1/2.5,1/2.5,1/2.5]))
                                                    .times( Mat4.translation([-2,1.25,0]))
                                                    .times( Mat4.scale([2,1.25,1]));
            _this.shapes.square.draw(context, program_state, window_transform2, _this.materials.plastic.override( cyan ));
            _this.shapes.square.draw(context, program_state, window_transform2.times( Mat4.translation([0,0,5])), _this.materials.plastic.override( cyan ));

            let decor_transform1 = base_transform.times( Mat4.translation([2.5,2.05,0]))
                                                 .times( Mat4.rotation(Math.PI/2, [0,0,-1]))
                                                 .times( Mat4.scale([1.25,0.05,0.05]));


            _this.shapes.box.draw(context, program_state, decor_transform1, _this.materials.plastic.override( papayawhip));
            _this.shapes.box.draw(context, program_state, decor_transform1.times( Mat4.translation([0,-100,0])), _this.materials.plastic.override( papayawhip));

            let decor_transform2 = base_transform.times( Mat4.translation([0,1.1,4.625]))
                                                 .times( Mat4.scale([1,0.3,3.375]))

            _this.shapes.box.draw(context, program_state, decor_transform2, _this.materials.plastic.override( papayawhip ));

            let front_transform = base_transform.times( Mat4.translation([0,2.05,1.25]))
                                                .times( Mat4.rotation(Math.PI/4, [-1,0,0]))
                                                .times( Mat4.scale([2.5,1.767,1]));

            _this.shapes.square.draw(context, program_state, front_transform, _this.materials.plastic.override( cyan ));

            let seattop_transform = base_transform.times( Mat4.translation([0,3.35,-2]))
                                                  .times( Mat4.scale([2.5,0.05,2]))

            _this.shapes.box.draw(context, program_state, seattop_transform, _this.materials.plastic.override( papayawhip)); 

            let seatback_transform = base_transform.times( Mat4.translation([0,2.05,-4]))
                                                   .times( Mat4.scale([2.5,1.25,0.05])) 

            _this.shapes.box.draw(context, program_state, seatback_transform, _this.materials.plastic.override( papayawhip ));

            let rear_transform = base_transform.times( Mat4.translation([0,1.3,-7.5]))
                                               .times( Mat4.scale([2.5,.5,.5]))

            _this.shapes.box.draw(context, program_state, rear_transform, _this.materials.plastic.override( papayawhip )); 

            let beam_transform = base_transform.times( Mat4.translation([2.5,2.05,1.25]))
                                               .times( Mat4.rotation(Math.PI/4, [1,0,0]))
                                               .times( Mat4.scale([0.05, 0.05,1.767]))

            _this.shapes.box.draw(context, program_state, beam_transform, _this.materials.plastic.override( papayawhip ));
            _this.shapes.box.draw(context, program_state, beam_transform.times( Mat4.translation([-100,0,0])), _this.materials.plastic.override( papayawhip ));

            let mirror1_transform = base_transform.times( Mat4.translation([2.5,2.05,1.25]))
                                                  .times( Mat4.rotation(Math.PI/3, [1,0,0]))
                                                  .times( Mat4.rotation(Math.PI/6, [0,0,-1]))
                                                  .times( Mat4.translation([.6,0,0]))
                                                  .times( Mat4.scale([.6,.2,.4]))
            _this.shapes.box.draw(context, program_state, mirror1_transform, _this.materials.plastic.override( papayawhip ));

            let mirror2_transform = base_transform.times( Mat4.translation([-2.5,2.05,1.25]))
                                                  .times( Mat4.rotation(Math.PI/3, [1,0,0]))
                                                  .times( Mat4.rotation(Math.PI/6, [0,0,1]))
                                                  .times( Mat4.translation([-.6,0,0]))
                                                  .times( Mat4.scale([.6,.2,.4]))

             _this.shapes.box.draw(context, program_state, mirror2_transform, _this.materials.plastic.override( papayawhip ));    
             
             if (_this.acceleration > 0.01 ) {
                 let flame_transformation = car_body.drawn_location.times(Mat4.translation([0,0,1.5]));
                 _this.shapes.ball_4.draw(context, program_state, flame_transformation, _this.materials.flame.override(blue));
             } 
          }                                                                                                                                                                             

      }

      function draw_tree(model_transform)
      {

        
        model_transform = model_transform.times(Mat4.translation([0,.8,0])).times(Mat4.scale([0.2,0.2,0.2]));
        let base_transform = model_transform.times( Mat4.rotation( Math.PI/2, [1,0,0]))
                                            .times( Mat4.scale([1,1,8]));
        let m_body = new Body(_this.shapes.cylinder, _this.materials.plastic.override( brown), Vec.of(1,1,1)).emplace(base_transform, 0, 0);
        if(_this.first_frame)
          _this.obstacles.push(m_body);
        m_body.shape.draw( context, program_state, m_body.drawn_location, m_body.material);
        
        let leaf_transform = model_transform.times( Mat4.translation([0,8,0]))
                                            .times( Mat4.scale([4,4,4]))
        _this.shapes.ball_4.draw(context, program_state, leaf_transform.times( Mat4.translation([0,.1,0])), _this.materials.leaves);
        _this.shapes.ball_4.draw(context, program_state, leaf_transform.times( Mat4.translation([0.6,-2/3,0])), _this.materials.leaves);
        _this.shapes.ball_4.draw(context, program_state, leaf_transform.times( Mat4.translation([-0.6,-2/3,-0.6])), _this.materials.leaves);
        _this.shapes.ball_4.draw(context, program_state, leaf_transform.times( Mat4.translation([-0.6,-2/3,0.6])), _this.materials.leaves);                                    
      }
      
      function draw_pinetree( model_transform)
      {
        model_transform = model_transform.times(Mat4.translation([0,0.8,0])).times(Mat4.scale([0.2,0.2,0.2]));
        let base_transform = model_transform.times( Mat4.rotation( Math.PI/2, [1,0,0]))
                                            .times( Mat4.scale([1,1,8]));
        
        _this.shapes.cylinder.draw(context, program_state, base_transform, _this.materials.plastic.override( brown ));

        let leaf_transform = model_transform.times( Mat4.translation([0,8,0]))
                                            .times( Mat4.rotation(2.17, [1,0,-1]))
                                            .times( Mat4.scale([10,10,10]))
        _this.shapes.tetrahedron.draw(context, program_state, leaf_transform, _this.materials.leaves);

        let leaf_transform2 = model_transform.times( Mat4.translation([0,11,0]))
                                            .times( Mat4.rotation(2.17, [1,0,-1]))
                                            .times( Mat4.scale([8,8,8]))
        _this.shapes.tetrahedron.draw(context, program_state, leaf_transform2, _this.materials.leaves);
                                            
       let leaf_transform3 = model_transform.times( Mat4.translation([0,13,0]))
                                            .times( Mat4.rotation(2.17, [1,0,-1]))
                                            .times( Mat4.scale([6,6, 6]))
        _this.shapes.tetrahedron.draw(context, program_state, leaf_transform3, _this.materials.leaves);
      }

      function draw_skybox( model_transform)
      {
        let front_transform = model_transform.times( Mat4.translation([0,0,-100]))
                                             .times( Mat4.scale([100,140,100]))
                                             .times( Mat4.rotation(Math.PI, [0,1,0]))
        _this.shapes.square.draw(context, program_state, front_transform, _this.materials.skybox_zneg);
        let back_transform = model_transform.times( Mat4.translation([0,0,100]))
                                            .times( Mat4.scale([100,140,100]))
        _this.shapes.square.draw(context, program_state, back_transform, _this.materials.skybox_zpos);

        let right_transform = model_transform.times( Mat4.translation([100,0,0]))
                                             .times( Mat4.scale([100,140,100]))
                                             .times( Mat4.rotation(Math.PI/2, [0,1,0]))
        _this.shapes.square.draw(context, program_state, right_transform, _this.materials.skybox_xpos);
        let left_transform = model_transform.times( Mat4.translation([-100,0,0]))
                                            .times( Mat4.scale([100,140,100]))
                                            .times( Mat4.rotation(Math.PI/2, [0,-1,0]))
        _this.shapes.square.draw(context, program_state, left_transform, _this.materials.skybox_xneg);

        let up_transform = model_transform.times( Mat4.translation([0,140,0]))
                                          .times( Mat4.scale([100,100,100]))
                                          .times( Mat4.rotation(Math.PI/2, [-1,0,0]))
        _this.shapes.square.draw(context, program_state, up_transform, _this.materials.skybox_ypos);
        let down_transform = model_transform.times( Mat4.translation([0,-140,0]))
                                          .times( Mat4.scale([100,100,100]))
                                          .times( Mat4.rotation(Math.PI/2, [1,0,0]))
        _this.shapes.square.draw(context, program_state, down_transform, _this.materials.skybox_yneg);                                                                                                                                                                                  
      }
      
      
     
    }


  
 
   
}



const Additional_Scenes = [];

export { Main_Scene, Additional_Scenes, Canvas_Widget, Code_Widget, Text_Widget, defs }


const Planar_Star = defs.Planar_Star =
class Planar_Star extends Shape
{                                 // **Planar_Star** defines a 2D five-pointed star shape.  The star's inner 
                                  // radius is 4, and its outer radius is 7.  This means the complete star 
                                  // fits inside a 14 by 14 sqaure, and is centered at the origin.
  constructor()
    { super( "position", "normal", "texture_coord" );
                    
      this.arrays.position.push( Vec.of( 0,0,0 ) );
      for( let i = 0; i < 11; i++ )
        {
          const spin = Mat4.rotation( i * 2*Math.PI/10, Vec.of( 0,0,-1 ) );

          const radius = i%2 ? 4 : 7;
          const new_point = spin.times( Vec.of( 0,radius,0,1 ) ).to3();

          this.arrays.position.push( new_point );
          if( i > 0 )
            this.indices.push( 0, i, i+1 )
        }         
                 
      this.arrays.normal        = this.arrays.position.map( p => Vec.of( 0,0,-1 ) );

    }
}

const Sun_Shader = defs.Sun_Shader =
class Sun_Shader extends Shader
{ update_GPU( context, gpu_addresses, graphics_state, model_transform, material )
    {
        const [ P, C, M ] = [ graphics_state.projection_transform, graphics_state.camera_inverse, model_transform ],
                      PCM = P.times( C ).times( M );
        context.uniformMatrix4fv( gpu_addresses.projection_camera_model_transform, false, Mat.flatten_2D_to_1D( PCM.transposed() ) );
        context.uniform1f ( gpu_addresses.animation_time, graphics_state.animation_time / 1000 ); 
        context.uniform4fv( gpu_addresses.sun_color,    material.color       ); 
        context.uniform1f( gpu_addresses.brightness,    .82       ); 
        context.uniform1f( gpu_addresses.pulseHeight,    0.       ); 
        context.uniform1f( gpu_addresses.fireSpeed,    2.       );
        context.uniform1f( gpu_addresses.turbulenceDetail,    .63       );      

    }

  shared_glsl_code()            // ********* SHARED CODE, INCLUDED IN BOTH SHADERS *********
    { return `precision mediump float;
              varying float disp; 
              uniform vec4 sun_color;
              uniform float animation_time;               
      `;
    }
  vertex_glsl_code()           // ********* VERTEX SHADER *********
    { return this.shared_glsl_code() + `
      uniform mat4 modelMatrix;
      uniform mat4 modelViewMatrix;
      uniform mat4 projectionMatrix;
      uniform mat4 viewMatrix;
      uniform mat3 normalMatrix;
      uniform mat4 projection_camera_model_transform;

      attribute vec3 position;
      attribute vec3 normal;
      attribute vec2 uv;
      attribute vec2 uv2;

      varying float noise;
      uniform float time;
      uniform float fireSpeed;
      uniform float pulseHeight;
      uniform float displacementHeight;
      uniform float turbulenceDetail;

      vec3 mod289(vec3 x) {
        return x - floor(x * (1.0 / 289.0)) * 289.0;
      }

      vec4 mod289(vec4 x) {
        return x - floor(x * (1.0 / 289.0)) * 289.0;
      }

      vec4 permute(vec4 x) {
        return mod289(((x*34.0)+1.0)*x);
      }

      vec4 taylorInvSqrt(vec4 r) {
        return 1.79284291400159 - 0.85373472095314 * r;
      }

      vec3 fade(vec3 t) {
        return t*t*t*(t*(t*6.0-15.0)+10.0);
      }

      // Klassisk Perlin noise 
      float cnoise(vec3 P) {
        vec3 Pi0 = floor(P); // indexing
        vec3 Pi1 = Pi0 + vec3(1.0); // Integer part + 1
        Pi0 = mod289(Pi0);
        Pi1 = mod289(Pi1);
        vec3 Pf0 = fract(P); // Fractional part for interpolation
        vec3 Pf1 = Pf0 - vec3(1.0); // Fractional part - 1.0
        vec4 ix = vec4(Pi0.x, Pi1.x, Pi0.x, Pi1.x);
        vec4 iy = vec4(Pi0.yy, Pi1.yy);
        vec4 iz0 = Pi0.zzzz;
        vec4 iz1 = Pi1.zzzz;

        vec4 ixy = permute(permute(ix) + iy);
        vec4 ixy0 = permute(ixy + iz0);
        vec4 ixy1 = permute(ixy + iz1);

        vec4 gx0 = ixy0 * (1.0 / 7.0);
        vec4 gy0 = fract(floor(gx0) * (1.0 / 7.0)) - 0.5;
        gx0 = fract(gx0);
        vec4 gz0 = vec4(0.5) - abs(gx0) - abs(gy0);
        vec4 sz0 = step(gz0, vec4(0.0));
        gx0 -= sz0 * (step(0.0, gx0) - 0.5);
        gy0 -= sz0 * (step(0.0, gy0) - 0.5);

        vec4 gx1 = ixy1 * (1.0 / 7.0);
        vec4 gy1 = fract(floor(gx1) * (1.0 / 7.0)) - 0.5;
        gx1 = fract(gx1);
        vec4 gz1 = vec4(0.5) - abs(gx1) - abs(gy1);
        vec4 sz1 = step(gz1, vec4(0.0));
        gx1 -= sz1 * (step(0.0, gx1) - 0.5);
        gy1 -= sz1 * (step(0.0, gy1) - 0.5);

        vec3 g000 = vec3(gx0.x,gy0.x,gz0.x);
        vec3 g100 = vec3(gx0.y,gy0.y,gz0.y);
        vec3 g010 = vec3(gx0.z,gy0.z,gz0.z);
        vec3 g110 = vec3(gx0.w,gy0.w,gz0.w);
        vec3 g001 = vec3(gx1.x,gy1.x,gz1.x);
        vec3 g101 = vec3(gx1.y,gy1.y,gz1.y);
        vec3 g011 = vec3(gx1.z,gy1.z,gz1.z);
        vec3 g111 = vec3(gx1.w,gy1.w,gz1.w);

        vec4 norm0 = taylorInvSqrt(vec4(dot(g000, g000), dot(g010, g010), dot(g100, g100), dot(g110, g110)));
        g000 *= norm0.x;
        g010 *= norm0.y;
        g100 *= norm0.z;
        g110 *= norm0.w;
        vec4 norm1 = taylorInvSqrt(vec4(dot(g001, g001), dot(g011, g011), dot(g101, g101), dot(g111, g111)));
        g001 *= norm1.x;
        g011 *= norm1.y;
        g101 *= norm1.z;
        g111 *= norm1.w;

        float n000 = dot(g000, Pf0);
        float n100 = dot(g100, vec3(Pf1.x, Pf0.yz));
        float n010 = dot(g010, vec3(Pf0.x, Pf1.y, Pf0.z));
        float n110 = dot(g110, vec3(Pf1.xy, Pf0.z));
        float n001 = dot(g001, vec3(Pf0.xy, Pf1.z));
        float n101 = dot(g101, vec3(Pf1.x, Pf0.y, Pf1.z));
        float n011 = dot(g011, vec3(Pf0.x, Pf1.yz));
        float n111 = dot(g111, Pf1);

        vec3 fade_xyz = fade(Pf0);
        vec4 n_z = mix(vec4(n000, n100, n010, n110), vec4(n001, n101, n011, n111), fade_xyz.z);
        vec2 n_yz = mix(n_z.xy, n_z.zw, fade_xyz.y);
        float n_xyz = mix(n_yz.x, n_yz.y, fade_xyz.x);
        return 2.2 * n_xyz;
      }

      // Ashima code 
      float turbulence( vec3 p ) {
          float t = -0.5;
          for (float f = 1.0 ; f <= 10.0 ; f++ ){
              float power = pow( 2.0, f );
              t += abs( cnoise( vec3( power * p ) ) / power );
          }
          return t;
      }

      void main() {
          noise = -0.8 * turbulence( .63 * position + ( animation_time * 1.0 ) );

          float b = 0. * cnoise(
              0.05 * position + vec3( 1.0 * animation_time )
          );
          float displacement = ( 0.0 - .65 ) * noise + b;

          vec3 newPosition = position + normal * displacement;
          gl_Position = projection_camera_model_transform * vec4( newPosition, 1.0 );
          disp = 20.*displacement;
      }`;
    }
  fragment_glsl_code()           // ********* FRAGMENT SHADER *********
    { return this.shared_glsl_code() + `
        // Indstiller presisionen, hvor meget plads denne type variabel må bruge (high betyder meget plads)
//       precision highp float;

//       // Varying er en variabel som interpolader for fragments, mellem hver vertex.
//       varying float noise;

//       uniform sampler2D tExplosion;
//       uniform float brightness;

      void main() {
//            float offset = .02;

//            // Det her er ikke helt depth, men mere hvor lys kuglen er. Da farven sættes ud fra dens dybde (se nærmere på brugen af noise i Vertex, for at finde ud om det). higher is dimmer 
//            float depth = 0.22;

//            // lookup vertically i texturen, ved brug af noise og offset (lidt ligesom normal)
//            // For at få de rigtige RGB værdier 
//            vec2 tPos = vec2( 0, ( brightness + depth ) * noise + offset );
//            vec4 color = texture2D( tExplosion, ( brightness - depth ) - tPos );
//            gl_FragColor = vec4( color.rgb, 0.8 );
           vec3 color = vec3((1.-disp), (0.1-disp*0.2)+0.1, (0.1-disp*0.1)+0.1*abs(sin(disp)));
           gl_FragColor = vec4( color.rgb, 1.0 );
           gl_FragColor *= sun_color;
      }` ;
    }
}

const Flame_Shader = defs.Flame_Shader =
class Flame_Shader extends Shader
{ update_GPU( context, gpu_addresses, graphics_state, model_transform, material )
    {
        const [ P, C, M ] = [ graphics_state.projection_transform, graphics_state.camera_inverse, model_transform ],
                      PCM = P.times( C ).times( M );
        context.uniformMatrix4fv( gpu_addresses.projection_camera_model_transform, false, Mat.flatten_2D_to_1D( PCM.transposed() ) );
        context.uniform1f ( gpu_addresses.animation_time, graphics_state.animation_time / 1000 ); 
        context.uniform4fv( gpu_addresses.sun_color,    material.color       ); 
        context.uniform1f( gpu_addresses.brightness,    .82       ); 
        context.uniform1f( gpu_addresses.pulseHeight,    0.       ); 
        context.uniform1f( gpu_addresses.fireSpeed,    2.       );
        context.uniform1f( gpu_addresses.turbulenceDetail,    .63       );      

    }

  shared_glsl_code()            // ********* SHARED CODE, INCLUDED IN BOTH SHADERS *********
    { return `precision mediump float;
              varying float disp; 
              uniform vec4 sun_color;
              uniform float animation_time;               
      `;
    }
  vertex_glsl_code()           // ********* VERTEX SHADER *********
    { return this.shared_glsl_code() + `
      uniform mat4 modelMatrix;
      uniform mat4 modelViewMatrix;
      uniform mat4 projectionMatrix;
      uniform mat4 viewMatrix;
      uniform mat3 normalMatrix;
      uniform mat4 projection_camera_model_transform;

      attribute vec3 position;
      attribute vec3 normal;
      attribute vec2 uv;
      attribute vec2 uv2;

      varying float noise;
      uniform float time;
      uniform float fireSpeed;
      uniform float pulseHeight;
      uniform float displacementHeight;
      uniform float turbulenceDetail;

      vec3 mod289(vec3 x) {
        return x - floor(x * (1.0 / 289.0)) * 289.0;
      }

      vec4 mod289(vec4 x) {
        return x - floor(x * (1.0 / 289.0)) * 289.0;
      }

      vec4 permute(vec4 x) {
        return mod289(((x*34.0)+1.0)*x);
      }

      vec4 taylorInvSqrt(vec4 r) {
        return 1.79284291400159 - 0.85373472095314 * r;
      }

      vec3 fade(vec3 t) {
        return t*t*t*(t*(t*6.0-15.0)+10.0);
      }

      // Klassisk Perlin noise 
      float cnoise(vec3 P) {
        vec3 Pi0 = floor(P); // indexing
        vec3 Pi1 = Pi0 + vec3(1.0); // Integer part + 1
        Pi0 = mod289(Pi0);
        Pi1 = mod289(Pi1);
        vec3 Pf0 = fract(P); // Fractional part for interpolation
        vec3 Pf1 = Pf0 - vec3(1.0); // Fractional part - 1.0
        vec4 ix = vec4(Pi0.x, Pi1.x, Pi0.x, Pi1.x);
        vec4 iy = vec4(Pi0.yy, Pi1.yy);
        vec4 iz0 = Pi0.zzzz;
        vec4 iz1 = Pi1.zzzz;

        vec4 ixy = permute(permute(ix) + iy);
        vec4 ixy0 = permute(ixy + iz0);
        vec4 ixy1 = permute(ixy + iz1);

        vec4 gx0 = ixy0 * (1.0 / 7.0);
        vec4 gy0 = fract(floor(gx0) * (1.0 / 7.0)) - 0.5;
        gx0 = fract(gx0);
        vec4 gz0 = vec4(0.5) - abs(gx0) - abs(gy0);
        vec4 sz0 = step(gz0, vec4(0.0));
        gx0 -= sz0 * (step(0.0, gx0) - 0.5);
        gy0 -= sz0 * (step(0.0, gy0) - 0.5);

        vec4 gx1 = ixy1 * (1.0 / 7.0);
        vec4 gy1 = fract(floor(gx1) * (1.0 / 7.0)) - 0.5;
        gx1 = fract(gx1);
        vec4 gz1 = vec4(0.5) - abs(gx1) - abs(gy1);
        vec4 sz1 = step(gz1, vec4(0.0));
        gx1 -= sz1 * (step(0.0, gx1) - 0.5);
        gy1 -= sz1 * (step(0.0, gy1) - 0.5);

        vec3 g000 = vec3(gx0.x,gy0.x,gz0.x);
        vec3 g100 = vec3(gx0.y,gy0.y,gz0.y);
        vec3 g010 = vec3(gx0.z,gy0.z,gz0.z);
        vec3 g110 = vec3(gx0.w,gy0.w,gz0.w);
        vec3 g001 = vec3(gx1.x,gy1.x,gz1.x);
        vec3 g101 = vec3(gx1.y,gy1.y,gz1.y);
        vec3 g011 = vec3(gx1.z,gy1.z,gz1.z);
        vec3 g111 = vec3(gx1.w,gy1.w,gz1.w);

        vec4 norm0 = taylorInvSqrt(vec4(dot(g000, g000), dot(g010, g010), dot(g100, g100), dot(g110, g110)));
        g000 *= norm0.x;
        g010 *= norm0.y;
        g100 *= norm0.z;
        g110 *= norm0.w;
        vec4 norm1 = taylorInvSqrt(vec4(dot(g001, g001), dot(g011, g011), dot(g101, g101), dot(g111, g111)));
        g001 *= norm1.x;
        g011 *= norm1.y;
        g101 *= norm1.z;
        g111 *= norm1.w;

        float n000 = dot(g000, Pf0);
        float n100 = dot(g100, vec3(Pf1.x, Pf0.yz));
        float n010 = dot(g010, vec3(Pf0.x, Pf1.y, Pf0.z));
        float n110 = dot(g110, vec3(Pf1.xy, Pf0.z));
        float n001 = dot(g001, vec3(Pf0.xy, Pf1.z));
        float n101 = dot(g101, vec3(Pf1.x, Pf0.y, Pf1.z));
        float n011 = dot(g011, vec3(Pf0.x, Pf1.yz));
        float n111 = dot(g111, Pf1);

        vec3 fade_xyz = fade(Pf0);
        vec4 n_z = mix(vec4(n000, n100, n010, n110), vec4(n001, n101, n011, n111), fade_xyz.z);
        vec2 n_yz = mix(n_z.xy, n_z.zw, fade_xyz.y);
        float n_xyz = mix(n_yz.x, n_yz.y, fade_xyz.x);
        return 2.2 * n_xyz;
      }

      // Ashima code 
      float turbulence( vec3 p ) {
          float t = -0.5;
          for (float f = 1.0 ; f <= 10.0 ; f++ ){
              float power = pow( 2.0, f );
              t += abs( cnoise( vec3( power * p ) ) / power );
          }
          return t;
      }

      void main() {
          noise = -0.8 * turbulence( .63 * position + ( animation_time * 1.0 ) );

          float b = 0. * cnoise(
              0.05 * position + vec3( 1.0 * animation_time )
          );
          float displacement = ( 0.0 - 2. ) * noise + b;

          vec3 newPosition = position + normal * displacement;
          gl_Position = projection_camera_model_transform * vec4( newPosition, 1.0 );
          disp = 20.*displacement;
      }`;
    }
  fragment_glsl_code()           // ********* FRAGMENT SHADER *********
    { return this.shared_glsl_code() + `
        // Indstiller presisionen, hvor meget plads denne type variabel må bruge (high betyder meget plads)
//       precision highp float;

//       // Varying er en variabel som interpolader for fragments, mellem hver vertex.
//       varying float noise;

//       uniform sampler2D tExplosion;
//       uniform float brightness;

      void main() {
//            float offset = .02;

//            // Det her er ikke helt depth, men mere hvor lys kuglen er. Da farven sættes ud fra dens dybde (se nærmere på brugen af noise i Vertex, for at finde ud om det). higher is dimmer 
//            float depth = 0.22;

//            // lookup vertically i texturen, ved brug af noise og offset (lidt ligesom normal)
//            // For at få de rigtige RGB værdier 
//            vec2 tPos = vec2( 0, ( brightness + depth ) * noise + offset );
//            vec4 color = texture2D( tExplosion, ( brightness - depth ) - tPos );
//            gl_FragColor = vec4( color.rgb, 0.8 );
           vec3 color = vec3((1.-disp), (0.1-disp*0.2)+0.1, (0.1-disp*0.1)+0.1*abs(sin(disp)));
           gl_FragColor = vec4( color.rgb, 1.0 );
           gl_FragColor *= sun_color;
      }` ;
    }
}